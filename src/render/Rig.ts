// The shared humanoid rig: bone names used by the Blender auto-rigger, the fallback mannequin, the procedural
// Animator and the clip retargeter.
export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'wing_L', 'wing_R',
  'hair_B_1', 'hair_B_2', 'hair_B_3', 'hair_L_1', 'hair_L_2', 'hair_L_3', 'hair_R_1', 'hair_R_2', 'hair_R_3',
  'skirt_B_1', 'skirt_B_2', 'skirt_B_3', 'skirt_F_1', 'skirt_F_2', 'skirt_F_3'] as const;
export type BoneName = typeof BONES[number];

/** the body bones a mocap / keyframed clip can drive (everything else is procedural: wings, hair, cloth) */
export const RT = ['hips', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'] as const;
export type RtBone = typeof RT[number];
export const RT_INDEX = Object.fromEntries(RT.map((b, i) => [b, i])) as Record<RtBone, number>;
/** the next bone down each chain: a limb's direction is head -> child head */
export const RT_CHILD: Partial<Record<RtBone, RtBone>> = {
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head',
  shoulder_L: 'upperarm_L', upperarm_L: 'forearm_L', forearm_L: 'hand_L', shoulder_R: 'upperarm_R', upperarm_R: 'forearm_R', forearm_R: 'hand_R',
  thigh_L: 'shin_L', shin_L: 'foot_L', thigh_R: 'shin_R', shin_R: 'foot_R',
};
