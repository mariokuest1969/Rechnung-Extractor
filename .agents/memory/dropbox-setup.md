---
name: Dropbox setup preference
description: User's preferred Dropbox setup and credential-lifecycle constraint
---

Use App Key and App Secret entered inside RE2026, followed by Dropbox authorization and automatic renewal, rather than asking for manual access tokens or reconnecting a Replit connector.

**Why:** The user explicitly said the previous setup was too complicated and requested these inputs in the app.

**How to apply:** Keep Dropbox setup self-service in settings. Explain the one-time Dropbox redirect URI registration rather than reverting to manual token generation.

Treat the server encryption secret as persistent infrastructure: changing it requires migrating encrypted Dropbox credentials or reconnecting Dropbox.

**Why:** Uncoordinated secret rotation would render saved authorizations unreadable.

**How to apply:** Plan credential migration or reconnection before rotating the encryption secret; never store secret values in memory.
