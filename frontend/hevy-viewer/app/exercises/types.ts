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

export type RoutineSummary = {
  id: string;
  title: string;
  exercise_count: number;
  workout_count: number;
  total_volume_kg: number;
  total_estimated_1rm_kg: number;
  last_workout: string | null;
};

export type RoutineExerciseStats = {
  name: string;
  sets: number;
  volume_kg: number;
  top_weight_kg: number;
  top_reps: number;
  metric: "1rm" | "reps";
  strength: number;
};

export type RoutineComparisonPoint = {
  workout_id: string;
  time: string;
  volume_kg: number;
  estimated_1rm_kg: number;
  muscle_groups?: Record<string, number>;
  effort_score?: number | null;
  effort_source?: "recorded_rpe" | "estimated_from_reps" | "insufficient_data";
  normalized_performance?: number;
  performance_index?: number;
  change_vs_previous_pct?: number | null;
  set_count?: number;
  duration_min?: number | null;
  exercises?: RoutineExerciseStats[];
};

export type ExerciseComparisonRow = {
  name: string;
  metric: "1rm" | "reps";
  current: number;
  baseline: number;
  change_pct: number;
  current_sets: number;
  baseline_sets: number;
  current_volume_kg: number;
  baseline_volume_kg: number;
  current_top: [number, number];
};

export type SessionBaselineComparison = {
  available: boolean;
  reason?: "no_baseline" | "insufficient_similarity" | "no_shared_exercises";
  status?: "improved" | "declined" | "similar";
  sample_size: number;
  performance_change_pct?: number;
  confidence?: "high" | "medium" | "low";
  muscle_overlap_pct?: number;
  volume_change_pct?: number | null;
  set_change_pct?: number | null;
  duration_change_pct?: number | null;
  baseline_time?: string;
  exercises?: ExerciseComparisonRow[];
  added_exercises?: string[];
  removed_exercises?: string[];
};

export type RoutinePerformanceComparison = {
  available: boolean;
  status: "improved" | "declined" | "similar" | "insufficient_data" | "insufficient_similarity";
  message: string;
  confidence: "high" | "medium" | "low";
  current?: {
    workout_id: string;
    time: string;
    performance_index: number;
    volume_kg: number;
    set_count: number;
    duration_min: number | null;
  };
  vs_previous?: SessionBaselineComparison;
  vs_rolling?: SessionBaselineComparison;
};

export type RoutineAnalytics = {
  routine_id: string;
  workout_count: number;
  total_volume_kg: number;
  total_estimated_1rm_kg: number;
  comparison_points: RoutineComparisonPoint[];
  performance_comparison?: RoutinePerformanceComparison;
};
