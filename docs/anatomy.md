# Phase 1–2 anatomical reference catalog

`src/data/anatomy.ts` exports `bones: Bone[]` and `sources: AnatomySource[]`, conforming to `src/lib/types.ts`. `src/lib/anatomy.ts` provides lookup, search, direct relationships, and regional selection.

## Scope and counting convention

This is a **reference catalog, not a clinically verified complete ontology** or a patient-specific model. It represents the conventional 206-bone adult skeleton; individual anatomy, fusion, and accessory bones vary. Teeth, cartilage, sutural/accessory bones, and variable additional sesamoids are not separate records. Each hip bone, sacrum, coccyx, and sternum is counted once; developmental components are not additional bones.

| Count group | Records | `region` |
| --- | ---: | --- |
| Skull | 22 (8 cranial + 14 facial) | Skull |
| Auditory ossicles | 6 | Auditory ossicles |
| Hyoid | 1 | Hyoid |
| Vertebral column | 26 | Vertebral column |
| Thoracic cage | 25 | Thoracic cage |
| **Axial subtotal** | **80** | |
| Shoulder girdle | 4 | Shoulder girdle |
| Upper limbs, including hands | 60 | Upper limb: 6; Hand: 54 |
| Pelvic girdle | 2 | Pelvic girdle |
| Lower limbs, including feet | 60 | Lower limb: 8; Foot: 52 |
| **Appendicular subtotal** | **126** | |
| **Total** | **206** | |

There are 86 left, 86 right, and 34 midline records. Each side has eight carpals, five metacarpals, fourteen hand phalanges, seven tarsals, five metatarsals, and fourteen foot phalanges. The thumb and great toe have no middle phalanx. `group` gives narrower descriptive families; `region` uses the shared contract's exact region labels.

## Stable identifier convention

IDs use uppercase ASCII and underscores; numbers are unpadded. Patient left/right is anatomical laterality, not screen position. Paired bones append `_LEFT` or `_RIGHT`.

- Midline skull: `FRONTAL`, `OCCIPITAL`, `SPHENOID`, `ETHMOID`, `VOMER`, `MANDIBLE`.
- Paired skull bases: `PARIETAL`, `TEMPORAL`, `MAXILLA`, `ZYGOMATIC`, `NASAL`, `LACRIMAL`, `PALATINE`, `INFERIOR_NASAL_CONCHA`.
- Paired ossicles: `MALLEUS`, `INCUS`, `STAPES`.
- Other midline: `HYOID`, `STERNUM`, `SACRUM`, `COCCYX`.
- Vertebrae: `C1`–`C7`, `T1`–`T12`, `L1`–`L5`; `C1` is atlas and `C2` axis. No laterality suffixes or separately counted sacral/coccygeal vertebrae.
- Ribs: `RIB_1_LEFT` through `RIB_12_LEFT`, and corresponding right IDs.
- Paired girdle/limb bases: `CLAVICLE`, `SCAPULA`, `HUMERUS`, `RADIUS`, `ULNA`, `PELVIS`, `FEMUR`, `PATELLA`, `TIBIA`, `FIBULA`.
- **`PELVIS_LEFT` and `PELVIS_RIGHT` mean individual hip/coxal bones**, not two whole pelves. Ilium, ischium, and pubis are fused regions, searchable as aliases, not separate records.
- Paired carpals: `SCAPHOID`, `LUNATE`, `TRIQUETRUM`, `PISIFORM`, `TRAPEZIUM`, `TRAPEZOID`, `CAPITATE`, `HAMATE`.
- Paired tarsals: `TALUS`, `CALCANEUS`, `NAVICULAR`, `CUBOID`, `MEDIAL_CUNEIFORM`, `INTERMEDIATE_CUNEIFORM`, `LATERAL_CUNEIFORM`.
- Metacarpals/metatarsals: `METACARPAL_{1..5}_{LEFT|RIGHT}` and `METATARSAL_{1..5}_{LEFT|RIGHT}`.
- Phalanges: `{HAND|FOOT}_{PROXIMAL|MIDDLE|DISTAL}_PHALANX_{1..5}_{LEFT|RIGHT}`, omitting `MIDDLE` for digit 1. Hand digits run thumb to little finger; foot digits run great to little toe. Examples: `HAND_DISTAL_PHALANX_1_LEFT`, `FOOT_MIDDLE_PHALANX_4_RIGHT`.

`meshId` currently equals `id` as a prospective asset-node binding only. **No mesh geometry, dimensions, coordinates, spatial calibration, or asset availability is asserted.** `dimensions` and `spatial` are always `null`. A renderer must separately validate real licensed assets. Latin names are uninflected bone terms without a laterality claim; uncurated Latin names are `null`. Shape categories are educational labels, not measurements; pisiform and patella are classified as sesamoid.

## Provenance and limitations

Facts are concise, originally worded summaries of public anatomy references, not copied textbook prose or imagery. The source registry links OpenStax's *Anatomy and Physiology 2e* (Rice University). These chapter URLs were successfully fetched on **2026-11-04**:

| Source ID | Reference and coverage |
| --- | --- |
| `classification` | [6.2 Bone Classification](https://openstax.org/books/anatomy-and-physiology-2e/pages/6-2-bone-classification): educational shape categories |
| `divisions` | [7.1 Divisions](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-1-divisions-of-the-skeletal-system): adult count and divisions |
| `skull` | [7.2 Skull](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-2-the-skull): skull and hyoid, landmarks and selected sutures |
| `spine` | [7.3 Vertebral Column](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-3-the-vertebral-column): vertebral identities and serial joints |
| `thorax` | [7.4 Thoracic Cage](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-4-the-thoracic-cage): ribs, sternum and cartilage-mediated connections |
| `shoulder` | [8.1 Pectoral Girdle](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-1-the-pectoral-girdle): clavicle and scapula |
| `upper` | [8.2 Upper Limb](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-2-bones-of-the-upper-limb): arm, forearm, wrist, hand |
| `pelvis` | [8.3 Pelvic Girdle](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-3-the-pelvic-girdle-and-pelvis): hip bones, sacroiliac joints and pubic symphysis |
| `lower` | [8.4 Lower Limb](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-4-bones-of-the-lower-limb): thigh, knee, leg, foot |
| `hearing` | [14.1 Sensory Perception](https://openstax.org/books/anatomy-and-physiology-2e/pages/14-1-sensory-perception): middle-ear ossicular chain |

The [current preface](https://openstax.org/books/anatomy-and-physiology-2e/pages/preface), also fetched on that date, identifies the textbook license as **CC BY-NC-SA 4.0**, not CC BY alone. `sources[].license` reports that upstream license, not a blanket license for external media or future meshes. Third-party exceptions can apply. No textbook images or model assets are included.

`sourceIds` provide **record-level provenance**, not claim-level or edge-level citations: count/classification references, the relevant regional chapter, and any chapter supporting an added relationship. The shared contract has no per-fact or per-edge citation field. The internal `connect(a, b, joint, source)` calls retain the source for each curated edge and add it to both endpoint records. `joints` contains deduplicated descriptive labels, not a joint ontology or a positional mapping to `connectedBoneIds`. Some classifications and terminology reflect conventional anatomy usage; these records have not undergone independent clinical review.

Landmarks and functions are selective, not exhaustive. Empty landmarks indicate uncurated detail, not anatomical absence. `clinicalInformation` and `fractureRegions` remain empty: there is no unsupported clinical guidance, incidence claim, or universal fracture rule.

## Relationship semantics

- Edges are curated, reciprocal, unique, and non-self. They describe selected articulations, including fibrous/cartilaginous articulations, not all nearby structures. Missing edges **do not establish absence of articulation**.
- Skull coverage currently includes major vault sutures and temporomandibular joints; many facial/skull-base articulations are intentionally uncurated. Intercarpal and additional carpometacarpal/tarsometatarsal contacts are also incomplete.
- Vertebral adjacency is explicitly anatomical (including C7–T1, T12–L1, L5–sacrum). It is not a generic numeric-neighbor rule. Sacrococcygeal fusion can vary.
- Ribs connect to the same-numbered thoracic vertebra; ribs 2–9 also connect to the vertebra above. This is a conventional selection, not a complete account of costal facet variants. Rib 10 variants and detailed joint surfaces are not modeled.
- Ribs 1–7 have a labeled **connection via costal cartilage** to sternum. These are not direct bone-on-bone contacts. Ribs 8–12 do not receive sternum edges; interchondral connections are omitted. **No rib-to-rib edges are inferred from adjacent numbers.**
- Hyoid has no bony articulation edges. Scapulothoracic functional motion is not a scapula–rib bony articulation. No direct ulna–carpal, femur–fibula, or patella–tibia articulation is invented.
- `counterpartId` is independent of the edge graph: left/right counterparts are not generally articulating. Some do articulate (for example, hip bones at the pubic symphysis).

## API behavior

```typescript
import { bones, sources } from "../src/data/anatomy";
import { getBone, getRelatedBones, getRegionalBones, searchBones } from "../src/lib/anatomy";

getBone("FEMUR_LEFT");
searchBones("left femur"); // Same result as FEMUR_LEFT or femur left.
searchBones("os coxae", { side: "Left", division: "Appendicular" });
searchBones("phalanges", { region: "Hand" });
getRelatedBones("FEMUR_LEFT"); // Left hip bone, left tibia, left patella.
getRegionalBones("FEMUR_LEFT"); // All 8 Lower limb records, both sides.
```

- Search includes IDs, English names, curated Latin names, laterality, region/division/group, and common aliases (collarbone, shoulder blade, kneecap, thighbone, tailbone, jaw, atlas/axis, digit names, etc.). Punctuation, underscores, hyphens, diacritics, and case normalize. An exact normalized ID or display-name match takes precedence over broader token matches. Otherwise query terms are ANDed in any order; alphabetic prefixes are supported. Numeric-bearing tokens match exactly, preventing `C1`/`RIB_1` collisions with larger numbers. Alias coverage is finite; this is not a medical-language parser.
- Filters use case-insensitive normalized **exact** region, side, and division labels. Blank filters are ignored; unknown nonblank filters yield no results. Empty/whitespace queries return all records meeting filters, in catalog order.
- `getBone` accepts a stable ID, tolerating case and separator differences; it does not resolve arbitrary names or reversed ID tokens. Unknown IDs return `undefined`.
- `getRelatedBones` returns only direct curated articulation neighbors, not counterparts, region peers, or transitive neighbors. Unknown IDs return `[]`.
- `getRegionalBones` returns both sides of the exact `region`, including the selected record; Hand and Foot are separate from Upper limb and Lower limb. Unknown IDs return `[]`.
- Result arrays are fresh, but records reference the exported catalog. Consumers should treat records as read-only; the index is built once, not designed for runtime catalog mutation.

## Validation

Run the existing runner without installing additional tools:

```powershell
npm test -- tests/anatomy.test.ts
```

Tests independently enumerate expected IDs, verify all subtotals and pairing, enforce source and geometry constraints, check reciprocal/mirrored edges and known exclusions, and cover every ID/display-name search, aliases, filters, unknown IDs, and region semantics. Passing structural tests is not clinical validation or proof that the relationship graph is complete.
