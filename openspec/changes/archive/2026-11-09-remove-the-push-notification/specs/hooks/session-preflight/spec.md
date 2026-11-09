## REMOVED Requirements

### Requirement: The preflight SHALL report whether push is configured, as advice

**Reason**: The push is removed, so there is nothing to configure. The row also read the topic variable, which is the read the plugin directory holds the plugin for.

**Migration**: `interlock doctor` carries no `notify` row. A person who set `INTERLOCK_NTFY_TOPIC` can unset it; nothing reads it.
