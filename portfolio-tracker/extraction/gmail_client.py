"""
Gmail integration.

RUN THIS ON YOUR OWN MACHINE — it needs YOUR Google account's OAuth consent, which I can't
do from a sandbox. See ../README.md for the one-time Google Cloud Console setup
(enable Gmail API, download credentials.json).

First run: opens a browser tab for you to approve access, then saves a token.json so every
run after that is non-interactive (needed for scheduling this later).
"""

import base64
import os
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
TOKEN_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "token.json")
CREDENTIALS_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "credentials.json")


def get_gmail_service():
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def fetch_new_emails(sender_email: str, since: datetime) -> list[dict]:
    """
    Returns a list of {"id": ..., "subject": ..., "body": ..., "date": ...} for messages
    from `sender_email` received after `since`.
    """
    service = get_gmail_service()
    query = f"from:{sender_email} after:{int(since.timestamp())}"
    results = service.users().messages().list(userId="me", q=query).execute()
    message_ids = results.get("messages", [])

    emails = []
    for msg_ref in message_ids:
        msg = service.users().messages().get(
            userId="me", id=msg_ref["id"], format="full"
        ).execute()
        emails.append(_parse_message(msg))
    return emails


def _parse_message(msg: dict) -> dict:
    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    body = _extract_body(msg["payload"])
    return {
        "id": msg["id"],
        "subject": headers.get("Subject", ""),
        "date": headers.get("Date", ""),
        "body": body,
    }


def _extract_body(payload: dict) -> str:
    """Handles both plain single-part and multipart (text/plain preferred) messages."""
    if payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="ignore")
    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="ignore")
    # fall back to any nested part
    for part in payload.get("parts", []):
        text = _extract_body(part)
        if text:
            return text
    return ""


if __name__ == "__main__":
    # Quick manual test: lists emails from a sender in the last 30 days
    import sys
    sender = sys.argv[1] if len(sys.argv) > 1 else input("Sender email to test: ")
    emails = fetch_new_emails(sender, datetime.now() - timedelta(days=30))
    print(f"Found {len(emails)} email(s) from {sender} in the last 30 days.")
    for e in emails:
        print(f"  - {e['date']}: {e['subject']}")
