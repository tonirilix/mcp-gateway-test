# 05: Admin-only Analytics user tools

**What to build:** The admin can opt into and call mock Analytics user creation and deactivation tools. The standard user can see that these tools exist in the portal but cannot enable or invoke them. The tools affect only fictional Analytics users, not gateway accounts.

**Blocked by:** 04: Per-user tool opt-in.

**Status:** resolved

- [x] The portal labels Analytics user creation and deactivation as data-changing and admin-only, independently of downstream MCP annotations.
- [x] The admin can enable each tool and call it through the gateway; the resulting change is visible in mock Analytics data.
- [x] The standard user cannot enable or call either tool, including by guessing its exposed name.
- [x] Ordinary tools, including GitLab issue deletion, remain eligible for standard-user opt-in.
- [x] Gateway accounts cannot be created, deactivated, or deleted through these downstream tools.
