# BIMobject permission notes

Date reviewed: 2026-08-02

Reviewer: OpenAI Codex technical-art and rights review

Terms source: <https://business.bimobject.com/terms-of-service-eula>
Terms effective date shown by the source: 2025-06-24

## Production decision

No BIMobject model, texture, material, metadata, measurement, or download is
used in Kaki Rally. All 17 named candidates in `BIMOBJECT_CANDIDATES.json` are
RED for the public game because the general terms do not grant the full rights
this wave requires: transformation, interactive-game inclusion, public
hosting, redistribution with the game, commercial use, and continued inclusion
after modification.

The controlling provisions are:

- 4.4(b): downloaded BIM Objects are limited to personal, non-commercial use.
- 4.4(c): professional use is scoped to drawings, materials, and documents in
  construction or building projects, not a racing game.
- 4.7(f): distribution, sublicensing, transfer, or third-party access is
  prohibited.
- 4.7(g): incorporation into a product or service provided to a third party is
  prohibited.
- 4.7(i): proprietary notices may not be removed or obscured, so the required
  logo-removal step cannot be assumed lawful.
- 8.1: ownership remains with BIMobject and its licensors.

A format download button is not a redistribution license. A future candidate
can become GREEN only with a separate written agreement that explicitly covers
every required right. The agreement must be stored outside public source when
confidential, referenced by a non-secret permission-artifact path in the
ledger, and reviewed before acquisition or production use.

## Authentication and acquisition record

The owner supplied a saved BIMobject cookie file outside this repository. It
was parsed in memory and used only to open a local Playwright browser on
BIMobject. No cookie value, authorization header, profile, or session file was
printed, copied, transmitted, summarized, screenshotted, or committed.

Normal site search and product listings were inspected deliberately. When the
protected format selector redirected to login, the session was treated as
expired and acquisition stopped. No CAPTCHA, access control, or private API was
bypassed. No product archive was downloaded, so source sizes, formats, and
checksums remain explicitly unknown in the candidate ledger.

`asset_staging/` is ignored. Production manifests are tested to reject staging,
absolute, external-network, and BIMobject paths.

## Clean-room replacement rule

The seven `assets/racing/world-v3/` GLBs are project-owned original work. Their
builders use only generic functional requirements and the existing Kaki art
direction. They do not import, trace, measure, simplify, or imitate a reviewed
product. Each source `.blend`, builder path, GLB checksum, and material source
is recorded in `ASSET_RIGHTS_LEDGER.json`.

Catastrophe remains outside this wave and receives no manifest or runtime
change.
