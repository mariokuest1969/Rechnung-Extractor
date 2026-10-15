---
name: Dropbox setup preference
description: User's preferred Dropbox setup and credential-lifecycle constraint
---

Use App Key and App Secret entered inside RE2026, followed by Dropbox authorization and automatic renewal, rather than asking for manual access tokens or reconnecting a Replit connector.

**Why:** The user explicitly said the previous setup was too complicated and requested these inputs in the app. They subsequently confirmed that the Dropbox connection and folder access work correctly with this setup.

**How to apply:** Keep Dropbox setup self-service in settings. Explain the one-time Dropbox redirect URI registration rather than reverting to manual token generation.

The user wants to enter only the main folder in settings and always include its descendant folders.

**Why:** The user explicitly requested this to avoid configuring individual subfolders.

**How to apply:** Preserve recursive discovery and pagination. Large folder trees should be processed in batches rather than rejected based on the total number of PDFs.

Treat the server encryption secret as persistent infrastructure: changing it requires migrating encrypted Dropbox credentials or reconnecting Dropbox.

**Why:** Uncoordinated secret rotation would render saved authorizations unreadable.

**How to apply:** Plan credential migration or reconnection before rotating the encryption secret; never store secret values in memory.

OAuth regression tests must never read or overwrite the saved Dropbox connection.

**Why:** The user explicitly required isolated token responses and a test store, without using the real connection.

**How to apply:** Keep automated lifecycle checks isolated from workspace credentials and live persistence; real consent testing requires separate user authorization.
