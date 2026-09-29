// The shared humanoid rig: bone names used by the Blender auto-rigger, the fallback mannequin, the procedural
// Animator and the clip retargeter.
export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'wing_L', 'wing_R',
  // dynamic chains (hair / cloth, simulated by Animator.dynamics): segments _1.._n, the highest index present is a
  // non-deforming tip marker. rig_hero.py rigs carry two segments (+ _3 tip), Tripo conversions three (+ _4 tip)
  'hair_B_1', 'hair_B_2', 'hair_B_3', 'hair_B_4', 'hair_L_1', 'hair_L_2', 'hair_L_3', 'hair_L_4', 'hair_R_1', 'hair_R_2', 'hair_R_3', 'hair_R_4',
  'skirt_B_1', 'skirt_B_2', 'skirt_B_3', 'skirt_B_4', 'skirt_F_1', 'skirt_F_2', 'skirt_F_3', 'skirt_F_4',
  'skirt_L_1', 'skirt_L_2', 'skirt_L_3', 'skirt_L_4', 'skirt_R_1', 'skirt_R_2', 'skirt_R_3', 'skirt_R_4',
  'cape_B_1', 'cape_B_2', 'cape_B_3', 'cape_B_4',
  // hair piled on the head (topknots, buns, dreadlocks: an upright chain) and wide sleeves hanging off the forearms
  'hair_T_1', 'hair_T_2', 'hair_T_3', 'hair_T_4',
  'sleeve_L_1', 'sleeve_L_2', 'sleeve_L_3', 'sleeve_L_4', 'sleeve_R_1', 'sleeve_R_2', 'sleeve_R_3', 'sleeve_R_4'] as const;
export type BoneName = typeof BONES[number];
/** the dynamic chains a rig can carry (skirt panels in ring order: front, left, back, right) */
export const CHAIN_PREFIXES = ['hair_B', 'hair_L', 'hair_R', 'skirt_F', 'skirt_L', 'skirt_B', 'skirt_R', 'cape_B', 'hair_T', 'sleeve_L', 'sleeve_R'] as const;
export type ChainPrefix = typeof CHAIN_PREFIXES[number];

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
