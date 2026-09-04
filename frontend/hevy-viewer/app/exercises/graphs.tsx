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
import { UnitSystem } from "../settings";

export type GraphPoint = VolumePoint | MaxWeightPoint | OneRepMaxPoint;

type GraphRendererProps = {
  points: GraphPoint[];
  unitSystem?: UnitSystem;
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

function formatWeight(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)} ${unit}`;
}

function Graph({ points, config, unitSystem = "kg" }: GraphRendererProps & { config: GraphConfig }): ReactNode {
  const data = toTimeSeries(points, config.valueKey);
  const multiplier = unitSystem === "lb" ? 2.20462 : 1;
  const unit = unitSystem === "lb" ? "lb" : "kg";
  const displayData = data.map((point) => ({ ...point, value: point.value * multiplier }));
  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No {config.label.toLowerCase()} data available yet.</p>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={displayData} margin={{ top: 20, right: 20, left: 12, bottom: 12 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 2" />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatDateLabel}
            stroke="var(--chart-axis)"
            minTickGap={24}
          />
          <YAxis
            dataKey="value"
            width={72}
            stroke="var(--chart-axis)"
            tickFormatter={(value: number) => formatWeight(value, unit)}
            domain={[
              (dataMin: number) => Math.max(0, dataMin - Math.max(dataMin * 0.08, 1)),
              (dataMax: number) => dataMax + Math.max(dataMax * 0.08, 1),
            ]}
            allowDecimals={false}
          />
          <Tooltip
            labelFormatter={(value) => formatDateLabel(Number(value))}
            formatter={(value) => [
              formatWeight(Number(value ?? 0), unit),
              config.label,
            ]}
            contentStyle={{ backgroundColor: "var(--tooltip-surface)", borderColor: "var(--border)", color: "var(--tooltip-text)" }}
            itemStyle={{ color: "var(--tooltip-text)" }}
            labelStyle={{ color: "var(--tooltip-text)" }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--chart-line)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--chart-line)" }}
            activeDot={{ r: 5, fill: "var(--chart-line)", stroke: "var(--tooltip-surface)" }}
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
    id: "one_rep_max",
    label: "Estimated 1RM",
    title: "Estimated 1RM over time",
    description: "Estimated one-repetition maximum using Epley's formula: weight × (1 + reps / 30).",
    valueKey: "one_rep_max_kg",
    unit: "kg",
    render: (props) => <Graph {...props} config={EXERCISE_GRAPHS[2]} />,
  },
];
