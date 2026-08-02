# BIMobject rights determination

**Date reviewed:** 2026-08-02
**Reviewer:** Claude C (agent-performed rights review for the
`feat/kaki-world-asset-overhaul` wave)
**Account used for inspection:** an already-authorised personal BIMobject
session belonging to the project owner. No credential value is recorded in this
repository, and no session data is committed.
**Terms reviewed:** BIMobject / Bim.com User Terms and EULA,
<https://business.bimobject.com/terms-of-service-eula>, as published on
2026-08-02.

## Outcome in one line

**No BIMobject-sourced geometry, texture, or material may ship in Kaki Rally.**
Every BIMobject candidate is classified **RED** for this project's intended use.
Zero candidates are GREEN. The world-asset wave therefore proceeds entirely
through original, clean-room Kaki kits built with the repository's reproducible
Blender tooling.

This is not a cautious reading. It is the plain text of the terms applied to
what Kaki Rally actually is.

## Why every candidate is RED

Kaki Rally is an MIT-licensed, publicly hosted game. It is distributed on
GitHub Pages, its source and assets are downloadable by anyone, and the wave
brief states an intent to preserve the option of "commercial use or future
commercial release". Those three facts are what the terms turn on.

The EULA defines the **Services** to include BIM Objects and Content
(section 4.4: "the Services, including BIM Objects and other Content"), and
section 8 confirms no ownership passes to the downloader. The restrictions
below therefore apply to the downloaded models themselves, not merely to the
website.

| Clause | Text (abridged) | Effect on Kaki Rally |
| --- | --- | --- |
| 4.4(b) | use downloaded BIM Objects "solely for your own personal use (and not for any commercial purposes or to make a profit)" | A public game build is not personal use. Kills redistribution outright. |
| 4.4(c) | professional use is limited to "drawing, material(s) or project documents … in a construction or other building project" | A racing game is not a construction project. Does not apply. |
| 4.4(d) | permits "3D printing (STL files) and … VR/AR applications (FBX files)" | Narrow, enumerated, and still subject to 4.7. A WebGL/WebGPU racing game is not a VR/AR application, and this clause grants no redistribution right. |
| 4.4(e) | educational use by institutions of education "in no way in a manner that results in commercial gain" | Kaki Rally is not an educational institution deliverable. |
| 4.7(f) | may not "rent, lease, distribute, sell, sublicense, transfer or provide access to the Services to a third party" | Publishing the build distributes the asset to every player. |
| 4.7(g) | may not "incorporate any Services into a product or service you provide to a third party" | This is precisely what shipping a game asset is. |
| 4.7(i) | may not "remove or obscure any proprietary or other notices contained in any Services" | Directly forbids the de-branding / logo-removal step the pipeline would require. An asset that must be de-branded to be usable cannot lawfully be de-branded. |
| 4.7(j) | may not use Content "to train or otherwise improve or enhance any artificial intelligence, machine learning, large language models" | No BIMobject file was passed to any generative or ML service. |
| 4.7(k) | may not use Content "for competitive analysis or to build competitive products" | Noted; not relied upon. |

Clauses 4.7(f) and 4.7(g) are independently fatal. Clause 4.7(i) is separately
fatal to the specific transformation pipeline the brief describes, because that
pipeline depends on stripping manufacturer branding.

There is no "downloadable therefore licensed" pathway here. The presence of an
FBX, OBJ, IFC, SKP, 3DS, or Revit download button on a product page confers no
redistribution right, and the wave brief already required that this inference
never be made.

## Access-method finding

The brief forbids reverse-engineering private download APIs, and EULA 4.7(a)
requires access "by any means other than through the interfaces of Bim.com" to
be avoided, with 4.7(h) prohibiting deriving non-public APIs.

A scripted downloader targeting BIMobject's internal
`/proxy/product-api-with-user/v1/.../binaryurls` endpoint exists on this
workstation from unrelated earlier work. **It was not used for this wave, and it
must not be.** Deriving that endpoint required reading the site's JavaScript
bundle, which is exactly the activity 4.7(h) and the brief both prohibit.

All rights review recorded here was performed by reading the published terms
page. No product file was downloaded for this wave. See
`docs/BIMOBJECT_CANDIDATES.json` for the per-candidate record.

## What happens instead

Under the wave's own autonomous decision rules — "do not ship it; do not stall
the entire wave; construct an original generic substitute" — the work proceeds
as clean-room construction.

This is legally sound because the *functional categories* Kaki Rally needs are
not protectable subject matter. A guardrail, a culvert, a trench drain, a
grandstand, a marshal post, and a light mast are utilitarian forms dictated by
function and long predating any manufacturer's catalogue. What is protectable is
a specific manufacturer's geometry, textures, ornamental design, distinctive
product appearance, and branding. None of that is used, referenced, traced, or
measured from.

Accordingly:

- No BIMobject file was downloaded, staged, imported, or converted for this wave.
- No Kaki kit piece is modelled from, traced over, or dimensioned against a
  BIMobject product.
- Every kit piece is generated procedurally by a committed Blender builder under
  `tools/blender/`, so its provenance is reproducible from source.
- Where real-world dimensions are needed for plausibility, they come from public
  standards and generic engineering practice, not from a product page.

## Standing rule for future waves

Treat BIMobject as **RED by default for anything that ships**. It remains usable
as ordinary professional reference for the project owner's own personal or
construction-industry purposes under 4.4(b)/(c), but that is a different
activity from building this game.

A future GREEN classification would require a separate written agreement with
BIMobject or with an individual manufacturer, explicitly granting
transformation, interactive-game inclusion, public hosting, redistribution,
commercial use, and continued inclusion after modification. Any such agreement
must be filed under `docs/permissions/` and referenced by candidate ID in
`docs/ASSET_RIGHTS_LEDGER.json` before a single file enters `assets/`.
