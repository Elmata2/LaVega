# Waitlist → Google Sheet (Apps Script)

The landing waitlist form (`apps/web/src/views/Landing.tsx`) POSTs sign-ups to a
Google Apps Script web app that appends rows to the **"LaVega — Wachtlijst"**
Google Sheet in the LaVega Drive folder.

Sheet: https://docs.google.com/spreadsheets/d/1jsz4U_P0jvDyWWGhbrK5jdrSvQojL_44GtG7X2byeEM/edit

## One-time setup (do this once, in your Google account)

1. Open the Sheet (link above).
2. **Extensions → Apps Script.**
3. Replace the default code with:

```js
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Tijdstip", "Naam", "E-mail", "Bron"]);
    }
    var p = (e && e.parameter) || {};
    sheet.appendRow([new Date(), p.name || "", p.email || "", p.source || ""]);
    return ContentService.createTextOutput("ok");
  } finally {
    lock.releaseLock();
  }
}
```

4. **Deploy → New deployment → Type: Web app.**
   - Description: `LaVega waitlist`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. **Deploy**, then **Authorize access** (grant your own account).
6. Copy the **Web app URL** (ends in `/exec`).
7. Send Claude that URL → it sets `WAITLIST_ENDPOINT` in `Landing.tsx` and redeploys.
   Until then the form shows a "Binnenkort" state (no sign-ups are silently dropped).

## Notes

- The browser POSTs `mode: "no-cors"` with a form-encoded body (name/email/source), so
  no CORS preflight is needed and Apps Script reads them via `e.parameter`.
- Because `no-cors` responses are opaque, the form optimistically confirms on a
  resolved request; that's fine for a waitlist.
- To change the destination, point the script at a different sheet (or update the
  header row); the client contract is just `name`, `email`, `source`.
