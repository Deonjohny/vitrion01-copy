import type { AnatomySource, Bone, Region, Side } from "../lib/types";

const textbook = "https://openstax.org/books/anatomy-and-physiology-2e/pages/";
export const sources: AnatomySource[] = [
  ["classification", "6.2 Bone Classification", "6-2-bone-classification"],
  ["divisions", "7.1 Divisions of the Skeletal System", "7-1-divisions-of-the-skeletal-system"],
  ["skull", "7.2 The Skull", "7-2-the-skull"],
  ["spine", "7.3 The Vertebral Column", "7-3-the-vertebral-column"],
  ["thorax", "7.4 The Thoracic Cage", "7-4-the-thoracic-cage"],
  ["shoulder", "8.1 The Pectoral Girdle", "8-1-the-pectoral-girdle"],
  ["upper", "8.2 Bones of the Upper Limb", "8-2-bones-of-the-upper-limb"],
  ["pelvis", "8.3 The Pelvic Girdle and Pelvis", "8-3-the-pelvic-girdle-and-pelvis"],
  ["lower", "8.4 Bones of the Lower Limb", "8-4-bones-of-the-lower-limb"],
  ["hearing", "14.1 Sensory Perception", "14-1-sensory-perception"],
].map(([id, title, page]) => ({
  id,
  title: `OpenStax Anatomy and Physiology 2e — ${title}`,
  url: textbook + page,
  license: "CC BY-NC-SA 4.0 (current OpenStax preface; third-party exceptions may apply)",
}));

export const bones: Bone[] = [];
const sides = ["Left", "Right"] as const;
const axialRegions: Region[] = ["Skull", "Auditory ossicles", "Hyoid", "Vertebral column", "Thoracic cage"];

type Entry = {
  id: string;
  name: string;
  region: Region;
  category: Bone["category"];
  group: string;
  source: string;
  landmarks: string[];
  functions: string[];
  latinName?: string;
};

function add(entry: Entry, side: Side = "Midline") {
  const paired = side !== "Midline";
  const id = paired ? `${entry.id}_${side.toUpperCase()}` : entry.id;
  bones.push({
    id,
    // An expected asset node identifier, not a claim that a mesh exists.
    meshId: id,
    name: paired ? `${side} ${entry.name}` : entry.name,
    latinName: entry.latinName ?? null,
    side,
    region: entry.region,
    division: axialRegions.includes(entry.region) ? "Axial" : "Appendicular",
    category: entry.category,
    group: entry.group,
    counterpartId: paired ? `${entry.id}_${side === "Left" ? "RIGHT" : "LEFT"}` : null,
    connectedBoneIds: [],
    joints: [],
    landmarks: [...entry.landmarks],
    functions: [...entry.functions],
    clinicalInformation: [],
    fractureRegions: [],
    dimensions: null,
    spatial: null,
    sourceIds: ["divisions", "classification", entry.source],
  });
}

function pair(entry: Entry) {
  for (const side of sides) add(entry, side);
}

const skull: [string, string, boolean, Bone["category"], string[], string][] = [
  ["FRONTAL", "Frontal bone", false, "Flat", ["Supraorbital margin"], "Forms the forehead and part of the orbital roof."],
  ["PARIETAL", "Parietal bone", true, "Flat", [], "Forms part of the cranial roof and lateral wall."],
  ["TEMPORAL", "Temporal bone", true, "Irregular", ["Mastoid process", "Mandibular fossa"], "Houses structures of hearing and balance."],
  ["OCCIPITAL", "Occipital bone", false, "Flat", ["Foramen magnum", "Occipital condyles"], "Forms the posterior cranial wall and part of its base."],
  ["SPHENOID", "Sphenoid bone", false, "Irregular", ["Sella turcica", "Greater wings"], "Contributes to the cranial base and orbits."],
  ["ETHMOID", "Ethmoid bone", false, "Irregular", ["Cribriform plate", "Crista galli"], "Contributes to the nasal cavity and medial orbital walls."],
  ["MAXILLA", "Maxilla", true, "Irregular", ["Alveolar process", "Palatine process"], "Supports upper teeth and contributes to the hard palate."],
  ["ZYGOMATIC", "Zygomatic bone", true, "Irregular", ["Temporal process"], "Forms the cheek prominence and part of the orbit."],
  ["NASAL", "Nasal bone", true, "Flat", [], "Supports the bony bridge of the nose."],
  ["LACRIMAL", "Lacrimal bone", true, "Flat", [], "Contributes to the medial orbital wall and tear drainage passage."],
  ["PALATINE", "Palatine bone", true, "Irregular", ["Horizontal plate"], "Forms the posterior portion of the hard palate."],
  ["INFERIOR_NASAL_CONCHA", "Inferior nasal concha", true, "Irregular", [], "Adds surface area to the lateral nasal wall."],
  ["VOMER", "Vomer", false, "Flat", [], "Forms part of the bony nasal septum."],
  ["MANDIBLE", "Mandible", false, "Irregular", ["Mandibular condyle", "Coronoid process", "Mental foramen"], "Supports lower teeth and moves during chewing."],
];
for (const [index, [id, name, paired, category, landmarks, fact]] of skull.entries()) {
  const entry: Entry = { id, name, region: "Skull", category, group: index < 6 ? "Cranial bones" : "Facial bones", source: "skull", landmarks, functions: [fact] };
  if (paired) pair(entry); else add(entry);
}
for (const [id, name, landmarks] of [
  ["MALLEUS", "Malleus", ["Handle"]],
  ["INCUS", "Incus", []],
  ["STAPES", "Stapes", ["Footplate"]],
] as [string, string, string[]][]) {
  pair({ id, name, latinName: name.toLowerCase(), region: "Auditory ossicles", category: "Irregular", group: "Auditory ossicles", source: "hearing", landmarks, functions: ["Transmits mechanical vibration through the middle ear."] });
}
add({ id: "HYOID", name: "Hyoid bone", region: "Hyoid", category: "Irregular", group: "Hyoid", source: "skull", landmarks: ["Body", "Greater horns", "Lesser horns"], functions: ["Provides attachment for tongue and neck muscles."] });

for (const [prefix, count, label] of [["C", 7, "Cervical"], ["T", 12, "Thoracic"], ["L", 5, "Lumbar"]] as const) {
  for (let number = 1; number <= count; number++) {
    const id = `${prefix}${number}`;
    add({
      id, name: `${label} vertebra ${number}${id === "C1" ? " (Atlas)" : id === "C2" ? " (Axis)" : ""}`,
      region: "Vertebral column", category: "Irregular", group: `${label} vertebrae`, source: "spine",
      landmarks: id === "C1" ? ["Anterior arch", "Posterior arch", "Lateral masses"] : id === "C2" ? ["Dens", "Vertebral body"] : ["Vertebral body", "Vertebral foramen", "Spinous process"],
      functions: [id === "C1" ? "Supports the skull at the atlanto-occipital joints." : id === "C2" ? "Provides a pivot for rotation of the atlas." : "Contributes to trunk support and the bony enclosure of the spinal canal."],
    });
  }
}
add({ id: "SACRUM", name: "Sacrum", latinName: "os sacrum", region: "Vertebral column", category: "Irregular", group: "Sacrum", source: "spine", landmarks: ["Sacral promontory", "Sacral foramina"], functions: ["Transfers load between the vertebral column and hip bones."] });
add({ id: "COCCYX", name: "Coccyx", latinName: "os coccygis", region: "Vertebral column", category: "Irregular", group: "Coccyx", source: "spine", landmarks: ["Base", "Apex"], functions: ["Provides attachment for pelvic floor structures."] });
add({ id: "STERNUM", name: "Sternum", latinName: "sternum", region: "Thoracic cage", category: "Flat", group: "Sternum", source: "thorax", landmarks: ["Manubrium", "Sternal angle", "Body", "Xiphoid process"], functions: ["Anchors the anterior thoracic cage."] });
for (let number = 1; number <= 12; number++) {
  pair({ id: `RIB_${number}`, name: `Rib ${number}`, region: "Thoracic cage", category: "Flat", group: number <= 7 ? "True ribs" : number <= 10 ? "False ribs" : "Floating ribs", source: "thorax", landmarks: number >= 11 ? ["Head", "Shaft"] : ["Head", "Neck", "Tubercle"], functions: ["Contributes to the protective thoracic cage and respiratory movement."] });
}

const limbEntries: Entry[] = [
  { id: "CLAVICLE", name: "Clavicle", latinName: "clavicula", region: "Shoulder girdle", category: "Long", group: "Shoulder girdle", source: "shoulder", landmarks: ["Sternal end", "Acromial end"], functions: ["Acts as a strut between the sternum and scapula."] },
  { id: "SCAPULA", name: "Scapula", latinName: "scapula", region: "Shoulder girdle", category: "Flat", group: "Shoulder girdle", source: "shoulder", landmarks: ["Acromion", "Coracoid process", "Glenoid cavity", "Spine"], functions: ["Provides muscle attachments and a socket for the humeral head."] },
  { id: "HUMERUS", name: "Humerus", latinName: "humerus", region: "Upper limb", category: "Long", group: "Arm", source: "upper", landmarks: ["Head", "Greater tubercle", "Trochlea", "Capitulum"], functions: ["Acts as a lever for upper arm movement."] },
  { id: "RADIUS", name: "Radius", latinName: "radius", region: "Upper limb", category: "Long", group: "Forearm", source: "upper", landmarks: ["Head", "Radial tuberosity", "Styloid process"], functions: ["Participates in forearm rotation and transfers loads from the wrist."] },
  { id: "ULNA", name: "Ulna", latinName: "ulna", region: "Upper limb", category: "Long", group: "Forearm", source: "upper", landmarks: ["Olecranon", "Trochlear notch", "Styloid process"], functions: ["Forms the forearm component of the elbow hinge."] },
  { id: "PELVIS", name: "Hip bone", latinName: "os coxae", region: "Pelvic girdle", category: "Irregular", group: "Hip bones", source: "pelvis", landmarks: ["Acetabulum", "Iliac crest", "Obturator foramen", "Ischial tuberosity"], functions: ["Transfers trunk load to the lower limb and supports pelvic organs."] },
  { id: "FEMUR", name: "Femur", latinName: "femur", region: "Lower limb", category: "Long", group: "Thigh", source: "lower", landmarks: ["Head", "Neck", "Greater trochanter", "Medial condyle", "Lateral condyle"], functions: ["Transmits load between the hip and knee."] },
  { id: "PATELLA", name: "Patella", latinName: "patella", region: "Lower limb", category: "Sesamoid", group: "Knee", source: "lower", landmarks: ["Base", "Apex", "Articular surface"], functions: ["Increases the leverage of the quadriceps tendon at the knee."] },
  { id: "TIBIA", name: "Tibia", latinName: "tibia", region: "Lower limb", category: "Long", group: "Leg", source: "lower", landmarks: ["Tibial tuberosity", "Anterior crest", "Medial malleolus"], functions: ["Transmits weight from the knee to the ankle."] },
  { id: "FIBULA", name: "Fibula", latinName: "fibula", region: "Lower limb", category: "Long", group: "Leg", source: "lower", landmarks: ["Head", "Lateral malleolus"], functions: ["Provides muscle attachments and lateral support at the ankle."] },
];
limbEntries.forEach(pair);

for (const name of ["Scaphoid", "Lunate", "Triquetrum", "Pisiform", "Trapezium", "Trapezoid", "Capitate", "Hamate"]) {
  pair({ id: name.toUpperCase(), name, region: "Hand", category: name === "Pisiform" ? "Sesamoid" : "Short", group: "Carpals", source: "upper", landmarks: name === "Hamate" ? ["Hook"] : name === "Scaphoid" ? ["Tubercle"] : [], functions: ["Contributes to the wrist skeleton."] });
}
for (const [id, name, landmarks, fact] of [
  ["TALUS", "Talus", ["Trochlea", "Head"], "Transfers load from the leg into the foot."],
  ["CALCANEUS", "Calcaneus", ["Calcaneal tuberosity", "Sustentaculum tali"], "Forms the bony heel and supports the rear foot."],
  ["NAVICULAR", "Navicular", ["Tuberosity"], "Contributes to the medial longitudinal arch."],
  ["CUBOID", "Cuboid", [], "Contributes to the lateral longitudinal arch."],
  ["MEDIAL_CUNEIFORM", "Medial cuneiform", [], "Contributes to the architecture of the midfoot."],
  ["INTERMEDIATE_CUNEIFORM", "Intermediate cuneiform", [], "Contributes to the architecture of the midfoot."],
  ["LATERAL_CUNEIFORM", "Lateral cuneiform", [], "Contributes to the architecture of the midfoot."],
] as [string, string, string[], string][]) {
  pair({ id, name, region: "Foot", category: "Short", group: "Tarsals", source: "lower", landmarks, functions: [fact] });
}

for (const part of ["HAND", "FOOT"] as const) {
  const hand = part === "HAND";
  const region = hand ? "Hand" : "Foot";
  const source = hand ? "upper" : "lower";
  const met = hand ? "METACARPAL" : "METATARSAL";
  for (let digit = 1; digit <= 5; digit++) {
    pair({ id: `${met}_${digit}`, name: `${hand ? "Metacarpal" : "Metatarsal"} ${digit}`, region, category: "Long", group: hand ? "Metacarpals" : "Metatarsals", source, landmarks: ["Base", "Shaft", "Head"], functions: [hand ? "Supports the palm and connects the wrist to a digit." : "Contributes to forefoot support and connects the midfoot to a toe."] });
    for (const segment of digit === 1 ? ["PROXIMAL", "DISTAL"] : ["PROXIMAL", "MIDDLE", "DISTAL"]) {
      pair({ id: `${part}_${segment}_PHALANX_${digit}`, name: `${region} digit ${digit} ${segment.toLowerCase()} phalanx`, region, category: "Long", group: `${region} phalanges`, source, landmarks: ["Base", "Shaft"], functions: [hand ? "Forms part of a digit used in grasping and manipulation." : "Forms part of a toe used in support and push-off."] });
    }
  }
}

const byId = new Map(bones.map((bone) => [bone.id, bone]));
function connect(a: string, b: string, joint: string, source: string) {
  const first = byId.get(a);
  const second = byId.get(b);
  if (!first || !second || a === b) throw new Error(`Invalid catalog articulation: ${a}, ${b}`);
  for (const [bone, other] of [[first, second], [second, first]]) {
    if (!bone.connectedBoneIds.includes(other.id)) bone.connectedBoneIds.push(other.id);
    if (!bone.joints.includes(joint)) bone.joints.push(joint);
    if (!bone.sourceIds.includes(source)) bone.sourceIds.push(source);
  }
}

// Curated subset: proximity and matching numbers alone are not evidence of articulation.
connect("PARIETAL_LEFT", "PARIETAL_RIGHT", "Sagittal suture", "skull");
for (const side of sides) {
  const suffix = side.toUpperCase();
  const id = (base: string) => `${base}_${suffix}`;
  connect("FRONTAL", id("PARIETAL"), "Coronal suture", "skull");
  connect("OCCIPITAL", id("PARIETAL"), "Lambdoid suture", "skull");
  connect(id("TEMPORAL"), id("PARIETAL"), "Squamous suture", "skull");
  connect("MANDIBLE", id("TEMPORAL"), "Temporomandibular joint", "skull");
  connect(id("MALLEUS"), id("INCUS"), "Incudomalleolar joint", "hearing");
  connect(id("INCUS"), id("STAPES"), "Incudostapedial joint", "hearing");
  connect("STERNUM", id("CLAVICLE"), "Sternoclavicular joint", "shoulder");
  connect(id("CLAVICLE"), id("SCAPULA"), "Acromioclavicular joint", "shoulder");
  connect(id("SCAPULA"), id("HUMERUS"), "Glenohumeral joint", "upper");
  connect(id("HUMERUS"), id("RADIUS"), "Humeroradial joint", "upper");
  connect(id("HUMERUS"), id("ULNA"), "Humeroulnar joint", "upper");
  connect(id("RADIUS"), id("ULNA"), "Proximal and distal radioulnar joints", "upper");
  connect(id("RADIUS"), id("SCAPHOID"), "Radiocarpal joint", "upper");
  connect(id("RADIUS"), id("LUNATE"), "Radiocarpal joint", "upper");
  connect(id("PISIFORM"), id("TRIQUETRUM"), "Pisotriquetral joint", "upper");
  connect("SACRUM", id("PELVIS"), "Sacroiliac joint", "pelvis");
  connect(id("PELVIS"), id("FEMUR"), "Hip joint", "lower");
  connect(id("FEMUR"), id("TIBIA"), "Tibiofemoral joint", "lower");
  connect(id("FEMUR"), id("PATELLA"), "Patellofemoral joint", "lower");
  connect(id("TIBIA"), id("FIBULA"), "Proximal tibiofibular joint and distal syndesmosis", "lower");
  connect(id("TIBIA"), id("TALUS"), "Talocrural joint", "lower");
  connect(id("FIBULA"), id("TALUS"), "Talocrural joint", "lower");
  connect(id("TALUS"), id("CALCANEUS"), "Subtalar articulation", "lower");
  connect(id("TALUS"), id("NAVICULAR"), "Talonavicular articulation", "lower");
  connect(id("CALCANEUS"), id("CUBOID"), "Calcaneocuboid joint", "lower");
  for (const cuneiform of ["MEDIAL_CUNEIFORM", "INTERMEDIATE_CUNEIFORM", "LATERAL_CUNEIFORM"]) {
    connect(id("NAVICULAR"), id(cuneiform), "Cuneonavicular joint", "lower");
  }
  for (let digit = 1; digit <= 5; digit++) {
    const carpal = ["TRAPEZIUM", "TRAPEZOID", "CAPITATE", "HAMATE", "HAMATE"][digit - 1];
    const tarsal = ["MEDIAL_CUNEIFORM", "INTERMEDIATE_CUNEIFORM", "LATERAL_CUNEIFORM", "CUBOID", "CUBOID"][digit - 1];
    connect(id(carpal), id(`METACARPAL_${digit}`), "Carpometacarpal joint", "upper");
    connect(id(tarsal), id(`METATARSAL_${digit}`), "Tarsometatarsal joint", "lower");
    for (const part of ["HAND", "FOOT"]) {
      const hand = part === "HAND";
      const source = hand ? "upper" : "lower";
      const proximal = id(`${part}_PROXIMAL_PHALANX_${digit}`);
      const distal = id(`${part}_DISTAL_PHALANX_${digit}`);
      connect(id(`${hand ? "METACARPAL" : "METATARSAL"}_${digit}`), proximal, hand ? "Metacarpophalangeal joint" : "Metatarsophalangeal joint", source);
      if (digit === 1) connect(proximal, distal, "Interphalangeal joint", source);
      else {
        const middle = id(`${part}_MIDDLE_PHALANX_${digit}`);
        connect(proximal, middle, "Proximal interphalangeal joint", source);
        connect(middle, distal, "Distal interphalangeal joint", source);
      }
    }
  }
  for (let rib = 1; rib <= 12; rib++) {
    connect(id(`RIB_${rib}`), `T${rib}`, "Costovertebral articulation", "thorax");
    if (rib >= 2 && rib <= 9) connect(id(`RIB_${rib}`), `T${rib - 1}`, "Costovertebral articulation", "thorax");
    if (rib <= 7) connect(id(`RIB_${rib}`), "STERNUM", "Sternocostal connection via costal cartilage", "thorax");
  }
}
connect("PELVIS_LEFT", "PELVIS_RIGHT", "Pubic symphysis", "pelvis");
connect("OCCIPITAL", "C1", "Atlanto-occipital joint", "spine");
const spine = [
  ...Array.from({ length: 7 }, (_, i) => `C${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `L${i + 1}`),
  "SACRUM", "COCCYX",
];
for (let index = 1; index < spine.length; index++) {
  const joint = index === 1 ? "Atlanto-axial joints" : spine[index] === "COCCYX" ? "Sacrococcygeal joint" : spine[index] === "SACRUM" ? "Lumbosacral joints" : "Intervertebral joints";
  connect(spine[index - 1], spine[index], joint, "spine");
}
