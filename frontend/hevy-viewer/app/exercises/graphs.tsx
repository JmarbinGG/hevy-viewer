"use client";

import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MaxWeightPoint, OneRepMaxPoint, VolumePoint } from "./types";

export type GraphPoint = VolumePoint | MaxWeightPoint | OneRepMaxPoint;

type GraphRendererProps = {
  points: GraphPoint[];
};

export type GraphConfig = {
  id: string;
  label: string;
  title: string;
  description: string;
  valueKey: "volume_kg" | "max_weight_kg" | "one_rep_max_kg";
  unit: string;
  render: (props: GraphRendererProps) => ReactNode;
};

type TimeSeriesPoint = {
  workout_id: string;
  timestamp: number;
  value: number;
};

function toTimeSeries(points: GraphPoint[], valueKey: GraphConfig["valueKey"]): TimeSeriesPoint[] {
  return points
    .map((point) => ({
      workout_id: point.workout_id,
      timestamp: new Date(point.time).getTime(),
      value: valueKey === "volume_kg"
        ? ("volume_kg" in point ? point.volume_kg : 0)
        : valueKey === "max_weight_kg"
          ? ("max_weight_kg" in point ? point.max_weight_kg : 0)
          : ("one_rep_max_kg" in point ? point.one_rep_max_kg : 0),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function formatDateLabel(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function Graph({ points, config }: GraphRendererProps & { config: GraphConfig }): ReactNode {
  const data = toTimeSeries(points, config.valueKey);
  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No {config.label.toLowerCase()} data available yet.</p>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid stroke="#e4e4e7" strokeDasharray="2 2" />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatDateLabel}
            stroke="#52525b"
            minTickGap={24}
          />
          <YAxis
            dataKey="value"
            stroke="#52525b"
            tickFormatter={(value: number) => `${value.toFixed(0)} kg`}
            allowDecimals={false}
          />
          <Tooltip
            labelFormatter={(value) => formatDateLabel(Number(value))}
            formatter={(value) => [
              `${Number(value ?? 0).toFixed(2)} kg`,
              config.label,
            ]}
            contentStyle={{ color: "#111111" }}
            itemStyle={{ color: "#111111" }}
            labelStyle={{ color: "#111111" }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#ffffff"
            strokeWidth={2}
            dot={{ r: 3, fill: "#FFFFFF" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const EXERCISE_GRAPHS: GraphConfig[] = [
  {
    id: "volume_over_time",
    label: "Volume",
    title: "Volume over time",
    description: "Total lifted volume for each workout session.",
    valueKey: "volume_kg",
    unit: "kg",
    render: (props) => <Graph {...props} config={EXERCISE_GRAPHS[0]} />,
  },
  {
    id: "max_over_time",
    label: "Max set weight",
    title: "Max set weight over time",
    description: "Heaviest completed set for each workout session.",
    valueKey: "max_weight_kg",
    unit: "kg",
    render: (props) => <Graph {...props} config={EXERCISE_GRAPHS[1]} />,
  },
  {
    id: "one_rep_max_over_time",
    label: "Estimated 1RM",
    title: "Estimated 1RM over time",
    description: "Estimated one-repetition maximum using Epley's formula: weight × (1 + reps / 30).",
    valueKey: "one_rep_max_kg",
    unit: "kg",
    render: (props) => <Graph {...props} config={EXERCISE_GRAPHS[2]} />,
  },
];
