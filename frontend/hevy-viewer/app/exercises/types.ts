export type ExerciseSummary = {
  id: string;
  name: string;
  muscle_groups: string[];
  workout_count: number;
  set_count: number;
  total_volume_kg: number;
};

export type HevyCredentials = {
  email_or_username: string;
  password: string;
};

export type LoginResponse = {
  user: {
    username: string | null;
    email: string | null;
  };
};

export type DataStatus = {
  exists: boolean;
  last_updated: string | null;
  workout_count?: number;
  needs_refresh: boolean;
};

export type VolumePoint = {
  workout_id: string;
  time: string;
  volume_kg: number;
};

export type MaxWeightPoint = {
  workout_id: string;
  time: string;
  max_weight_kg: number;
};

export type OneRepMaxPoint = {
  workout_id: string;
  time: string;
  one_rep_max_kg: number;
};

export type ExerciseGraphResponse = {
  exercise: string;
  graph: string;
  points: VolumePoint[] | MaxWeightPoint[] | OneRepMaxPoint[];
};
