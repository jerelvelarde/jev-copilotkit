"use client";

import { BookOpen, GitFork, Tag } from "lucide-react";
import type { ToolResult } from "../lib/tool-bench/executor";
import type { ToolExecution } from "../lib/tool-bench/types";

function prepare(result: ToolResult) {
  switch (result.kind) {
    case "article":
      return {
        icon: BookOpen,
        title: "Wikipedia article",
        url: result.url,
        rows: [
          { label: "Title", value: result.title },
          { label: "Introduction", value: result.extract },
          { label: "Article links", value: String(result.linkCount) },
        ],
      };
    case "repository":
      return {
        icon: GitFork,
        title: "GitHub repository",
        url: result.url,
        rows: [
          { label: "Repository", value: result.name },
          { label: "Description", value: result.description },
          { label: "Stars", value: result.stars.toLocaleString() },
          { label: "Language", value: result.language },
        ],
      };
    case "release":
      return {
        icon: Tag,
        title: "Latest GitHub release",
        url: result.url,
        rows: [
          { label: "Repository", value: result.repository },
          { label: "Release", value: result.name },
          { label: "Tag", value: result.tag },
          { label: "Published", value: result.publishedAt },
        ],
      };
  }
}

export function ToolResultCard({ execution }: { execution: ToolExecution }) {
  const result = execution.result as ToolResult;
  if (!result || !["article", "repository", "release"].includes(result.kind))
    return null;
  const prepared = prepare(result);
  const Icon = prepared.icon;
  return (
    <div className="tb-result-card">
      <div className="tb-result-title">
        <Icon size={13} aria-hidden="true" />
        <span>{prepared.title}</span>
        <a
          className="tb-result-source"
          href={prepared.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          live source ↗
        </a>
      </div>
      <dl className="tb-result-rows">
        {prepared.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
