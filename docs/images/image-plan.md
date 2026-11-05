# Site imagery plan

Status: **45 placed** (2026-11-05): the 13 below, plus `family-commercial`
and 31 program images (see [Program images](#program-images-2026-11-05)), so
every financing hub and program page has one. Every image is on the site;
`content/images.ts` holds each one's alt text and crop position. The
link-preview (share) image is still the text card in `app/opengraph-image.tsx`.
This is the record of every generated image on corincommercial.com: what it
shows, where it goes, the exact prompt, and the settings used. Keep this file
in step with `content/images.ts`.

## Rules

- **Asset classes, not evidence.** An image shows the *kind* of property Corin
  Commercial finances. It never claims to be a property Corin financed, a
  client, or a member of the team.
  - No generated images on `/track-record` or `/team`.
  - No generated images next to deal facts, except on the illustrative
    structure pages, under their "Illustrative" label.
- **No people, no vehicles.** This removes fair-housing human-model questions
  (FHA §804(c), 24 CFR 100.75, Gov. Code §12955), Reg B "visual images" risk,
  synthetic-performer and testimonial rules, and distorted-anatomy artifacts.
- **No text in any image:**
  - No signage, logos, flags, hotel brands, address numbers or license plates.
  - No recognizable landmarks or real buildings.
  - No money, keys, handshakes or gavels.
  - No text baked into images, so the DRE license line is never crowded out.
- **Disclosure.** None on the site: the owner decided on 2026-11-04 not to
  show an image disclosure line in the footer or captions on the structure
  pages. Never use the word "AI" (owner rule; `components/legal/copy.test.ts`).
- **Counsel to confirm.**
  - That no image disclosure is needed.
  - Whether residential-collateral pages need an Equal Housing statement.
  - That generated, people-free images trigger no AB 723 (B&P §10140.8) or
    New York synthetic-performer duty.

## Settings

- **Model:** OpenAI GPT Image 2.5 (`gpt_image_2_5`, variant `sunburst`) via
  Higgsfield.
- **Output:** quality `high`, resolution `2k`, aspect ratio `16:9`. Cost: 2.75
  credits per image.
- **Masters:** keep the subject in the central ~45% of the width and the middle
  ~75% of the height, so one master crops cleanly to 2:1, 16:9, 3:2 and 4:3.
- **Delivery:** WebP masters (as large as the source allows; ChatGPT gives
  1536 × 1024), stored under `assets/images/`, listed in `content/images.ts`
  and served through `next/image` static imports, which make every smaller
  size. Crops are done in CSS (`aspect-*` with `object-cover`), not as
  separate files. The settings above were for Higgsfield; the images now
  come from ChatGPT with the prompts in `chatgpt-prompts.md`.
  - **Converting:** sharp, WebP quality 80 (78 for the memory care courtyard,
    whose foliage needs it to stay under 400 KB), full 1536 × 1024, metadata
    stripped, no retouching. `content/images.test.ts` fails any file over
    400 KB or not referenced from `content/images.ts`.
  - **Crops on the site:** homepage hero 2:1 from md (4:3 on phones); About
    banner 2:1; structure pages 16:9; homepage family cards, the family rows
    on `/financing` and `/structures` cards 4:3. Financing hub and program
    heroes show the whole 3:2 master beside the heading, so program images
    carry no `position`. One `position` per image serves every crop: the
    wide crops only move vertically, the 4:3 crops only sideways.
  - **Loading:** the About banner, structure page images and financing page
    heroes are each page's largest paint on desktop, so they use `preload`.
    The homepage hero (which starts below the 1440 × 900 fold, under the
    facts row) uses `loading="eager"`. Cards are lazy; the homepage
    family-card photos show from md only and the `/financing` family photos
    from lg only, so phones never fetch them.
- **Review:** look at the whole set on a contact sheet before publishing.
  Check each image at 100% for:
  - stray lettering
  - converging verticals
  - floating balconies
  - shadows that don't match the sun direction

### House style (appended to every exterior prompt)

> Photorealistic architectural photograph, not a 3D rendering. Full-frame
> camera with a 24–35mm tilt-shift lens used only for perspective correction,
> everything in sharp focus; two-point perspective, vertical lines perfectly
> vertical, level horizon, eye-level viewpoint. Soft natural mid-morning
> daylight from the left, gentle directional shadows, clear pale slightly hazy
> sky, balanced exposure with detail in highlights and shadows, no HDR look.
> Neutral true-to-life color, slightly warm white balance, restrained
> saturation; palette of warm white, limestone, light oak, warm gray and muted
> sage-green drought-tolerant planting; no saturated blues, reds or oranges.
> Calm, uncluttered, well-maintained, unbranded contemporary California
> architecture. Main subject centered in the middle half of the frame with
> generous empty sky above and a clean foreground below. Empty of people and
> vehicles. No text, letters, numbers, signage, logos, flags, banners, address
> numbers, license plates, posters or screens. No lens flare, sun stars,
> vignette, miniature blur, watermark, border, or any recognizable real-world
> landmark, building or hotel brand.

**Interior and courtyard variant.** Replace the camera and light sentences
with: "20–24mm lens at 1.3 m height, one- or two-point perspective with
vertical lines vertical; large windows or open sky as the main light source,
interior lights off; bright but not blown-out highlights."

## Program images (2026-11-05)

32 new masters, approved 2026-11-05 and placed as delivered (1536 × 1024 WebP,
quality 80, under 400 KB, metadata stripped). How they were made is in
`chatgpt-prompts.md`. `content/images.ts` holds their alt text (as approved,
except that `closed` was dropped from the industrial alt, since no alt may
read like a closed deal), and `PENDING_IMAGES` there is now empty.

- **Commercial family:** `family-commercial.webp` is in `FAMILY_IMAGES`: the
  `/financing/commercial` hub hero, the homepage Commercial property card and
  its row on `/financing`.
- **Hard money:** `/financing/hard-money` is a program that doubles as its
  family's hub, so it keeps `family-hard-money`.
- **Reused structure images (no new file):**

| Program page | Image |
|---|---|
| `fix-and-flip` | `structure-investor-rehab-hard-money` |
| `pip-bridge` | `structure-flagged-hotel-sba-504-green-pip` |
| `hotel-to-senior-living-conversion` | `structure-hotel-to-assisted-living-conversion-bridge` |
| `memory-care` | `structure-memory-care-bridge-to-hud` |
| `rcfe` | `structure-assisted-living-sba-504-refinance` |
| `c-pace` | `structure-multifamily-construction-bank-cpace` |

- **Made for the page (31), in `PROGRAM_IMAGES`:**

| Program page | File |
|---|---|
| `acquisition-loans` | `program-acquisition-loans.webp` |
| `assisted-living` | `program-assisted-living.webp` |
| `bank-credit-union-loans` | `program-bank-credit-union-loans.webp` |
| `bridge-to-hud` | `program-bridge-to-hud.webp` |
| `cmbs-loans` | `program-cmbs-loans.webp` |
| `construction-loans` | `program-construction-loans.webp` |
| `construction-to-permanent` | `program-construction-to-permanent.webp` |
| `debt-fund-bridge-loans` | `program-debt-fund-bridge-loans.webp` |
| `dscr-investor` | `program-dscr-investor.webp` |
| `fannie-mae-multifamily` | `program-fannie-mae-multifamily.webp` |
| `freddie-mac-multifamily` | `program-freddie-mac-multifamily.webp` |
| `hotel-cmbs` | `program-hotel-cmbs.webp` |
| `hud-221d4` | `program-hud-221d4.webp` |
| `hud-223a7` | `program-hud-223a7.webp` |
| `hud-223f-multifamily` | `program-hud-223f-multifamily.webp` |
| `hud-223f-senior-housing` | `program-hud-223f-senior-housing.webp` |
| `hud-232` | `program-hud-232.webp` |
| `industrial-loans` | `program-industrial-loans.webp` |
| `life-company-loans` | `program-life-company-loans.webp` |
| `medical-office-loans` | `program-medical-office-loans.webp` |
| `mezzanine-preferred-equity` | `program-mezzanine-preferred-equity.webp` |
| `mixed-use-loans` | `program-mixed-use-loans.webp` |
| `mobile-home-park-loans` | `program-mobile-home-park-loans.webp` |
| `multifamily-bridge` | `program-multifamily-bridge.webp` |
| `office-loans` | `program-office-loans.webp` |
| `private-bridge` | `program-private-bridge.webp` |
| `retail-loans` | `program-retail-loans.webp` |
| `sba-504-hotel` | `program-sba-504-hotel.webp` |
| `sba-7a-504-hotel-stack` | `program-sba-7a-504-hotel-stack.webp` |
| `self-storage-loans` | `program-self-storage-loans.webp` |
| `skilled-nursing` | `program-skilled-nursing.webp` |

## The set (13 images)

All 13 are placed. The share image named in row 1 is not made yet.

| # | id | Used on | Subject (prompt lead, then the house style) |
|---|---|---|---|
| 1 | `home-hero` | Homepage hero, below the facts row (not lazy). Also to be cropped into the share image (not done yet). | Hero image for the homepage of a commercial real estate loan broker's website. A calm contemporary California street corner: a four-story apartment building with recessed balconies and light stucco beside a two-story landscaped courtyard building with a deep covered walkway; olive trees, lavender and ornamental grasses along a wide clean sidewalk; plain stone panels where signs would be. Camera across the street at 1.6 m. |
| 2 | `family-senior-living` | Senior living card on the homepage; senior living hub hero | Hero image for the senior living financing page. A single-story contemporary assisted living community in inland Southern California, seen from across its entry drive: off-white smooth stucco, light-wood soffits, soft-gray standing-seam roof, a deep covered walkway with slim columns leading to a glass entry, a plain stone panel above the door; olive trees, lavender and ornamental grasses along decomposed-granite paths. Late spring, 9:30 a.m. |
| 3 | `family-hotels` | Hotels card; hotels hub hero | Hero image for the hotel financing page. An independent five-story boutique hotel with a contemporary limestone and glass facade and a covered porte-cochère drop-off; warm light glowing from the empty lobby at early blue hour (the one blue-hour image in the set); blank fascia, no flag, no brand, no lettering. |
| 4 | `family-multifamily` | Multifamily card; multifamily hub hero | Hero image for the multifamily financing page. A five-story podium apartment building with recessed balconies, warm-white stucco and light-wood accents, street trees and a landscaped sidewalk planting strip; plain ground-floor glazing with no shop signs. |
| 5 | `family-construction` | Construction card; construction hub hero | Hero image for the construction financing page. A mid-rise apartment building under construction: wood framing over a finished concrete podium, a tower crane beside it, tidy fenced site, stacked materials, early morning, no workers, no company names on the fence or crane. |
| 6 | `family-hard-money` | Hard money card; hard money hub hero | Hero image for the hard money and bridge financing page. A freshly renovated 1960s two-story California fourplex: new windows, smooth light stucco, wood slat accents, a new low-water front garden and walkway; renovation just completed. |
| 7 | `about-california` | About page header image | Header image for the About page. A low oblique aerial view (about 35 degrees) of a generic inland California neighborhood: a mix of low-rise apartment buildings, a courtyard senior community, a small hotel and street trees, with soft hills in the distance; hazy morning light. No recognizable landmarks or real places. |
| 8 | `structure-assisted-living-sba-504-refinance` | That structure page and its card on `/structures` (not the homepage structure cards, which sit next to deal amounts) | A single-story residential-scale assisted living home in a California suburb: craftsman-style exterior, wide covered porch with an accessible ramp, mature trees, a tidy front garden. |
| 9 | `structure-flagged-hotel-sba-504-green-pip` | That structure page and its card | A four-story hotel mid-renovation: one wing behind clean scaffolding with new facade panels being installed, rooftop solar panels going in; blank fascia, no brand, flag or signage anywhere. |
| 10 | `structure-memory-care-bridge-to-hud` | That structure page and its card | Interior and courtyard variant. The enclosed garden courtyard of a two-story memory care community: a looping decomposed-granite walking path, raised planters, shaded benches, low walls, soft morning light. |
| 11 | `structure-hotel-to-assisted-living-conversion-bridge` | That structure page and its card | A two-story former motor-court motel being converted to residential care: fresh light stucco, new accessible entry ramp and handrails under construction, new drought-tolerant landscaping, palms; no signage. |
| 12 | `structure-multifamily-construction-bank-cpace` | That structure page and its card | A topped-out five-story apartment building nearing completion: finished podium, exterior cladding partly installed, rooftop solar arrays and high-efficiency HVAC units being installed, no crane, no workers. |
| 13 | `structure-investor-rehab-hard-money` | That structure page and its card | A 1960s two-story eight-unit apartment building mid-rehab: light scaffolding on one side, new windows staged on pallets, fresh primer on part of the facade, a small covered dumpster, sunny quiet street. |

**Not planned, on purpose:**
- Legal pages, calculators, the loan sizer, the rates board and forms.
- The glossary, `/team`, `/track-record`, 404 pages and the "Why a broker" band.

**Credits.** 13 images × 2.75 = 35.75 credits, plus about 10 redos to keep the
set consistent. Roughly 50–60 credits in total.
