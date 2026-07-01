import { Badge } from "@astryxdesign/core/Badge";
import { Code } from "@astryxdesign/core/Code";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack } from "@astryxdesign/core/HStack";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot as AstryxStatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Code as CodeIcon, InProgress, Play, StopOutline, Terminal } from "@carbon/icons-react";
import type {
  ActionResult,
  ProjectRuntimeHistoryEntry,
  ProjectRuntimeProcess,
  ProjectSummary,
  SafeAction,
} from "../../shared/types.ts";
import type { ProjectEvent } from "./types.ts";
import {
  eventDotVariant,
  runtimeHistoryBadgeVariant,
  runtimeHistoryDetail,
  runtimeHistoryDotVariant,
  runtimeHistoryPidLabel,
  runtimeHistoryStopBadge,
  statusBadgeVariant,
  statusDotVariant,
} from "./model.ts";

export function HistoryRow({ entry }: { entry: ProjectRuntimeHistoryEntry }) {
  const stopBadge = runtimeHistoryStopBadge(entry);

  return (
    <HStack align="center" className="history-row" gap={1.5} justify="between">
      <HStack align="center" gap={1}>
        <AstryxStatusDot
          label={`${entry.commandLabel} ${entry.status}`}
          variant={runtimeHistoryDotVariant(entry.status)}
        />
        <VStack gap={0}>
          <Text maxLines={1} weight="semibold">
            {entry.commandLabel}
          </Text>
          <Text
            color="secondary"
            hasTabularNumbers
            maxLines={1}
            type="supporting"
          >
            {runtimeHistoryDetail(entry)}
          </Text>
        </VStack>
      </HStack>
      <HStack align="center" gap={1} wrap="wrap">
        <Badge
          label={entry.status}
          variant={runtimeHistoryBadgeVariant(entry.status)}
        />
        {stopBadge ? (
          <Badge label={stopBadge.label} variant={stopBadge.variant} />
        ) : null}
        <Text color="secondary" hasTabularNumbers type="supporting">
          {runtimeHistoryPidLabel(entry)}
        </Text>
      </HStack>
    </HStack>
  );
}

export function ProcessRow({ process }: { process: ProjectRuntimeProcess }) {
  return (
    <HStack className="compact-row" gap={1} justify="between">
      <VStack gap={0}>
        <Text maxLines={1} weight="semibold">
          {process.command}
        </Text>
        <Text color="secondary" hasTabularNumbers type="supporting">
          pid {process.pid}
        </Text>
      </VStack>
      <Badge
        label={process.port ? `:${process.port}` : process.scope}
        variant={process.scope === "public" ? "warning" : "neutral"}
      />
    </HStack>
  );
}

export function ActionOutput({ result }: { result: ActionResult }) {
  return (
    <Section
      aria-label="Action output"
      className="action-output"
      padding={0}
      variant="transparent"
    >
      <VStack gap={1}>
        <Text color="secondary" type="label">
          Command
        </Text>
        <Code className="command-code">{result.command}</Code>
        <CodeBlock
          code={result.stdout || result.stderr || "No output"}
          container="section"
          isWrapped
          language="shell"
          maxHeight="14rem"
          size="sm"
          title="Output"
          width="100%"
        />
        {result.redacted ? (
          <Text color="secondary" type="supporting">
            Secret-like values were redacted.
          </Text>
        ) : null}
      </VStack>
    </Section>
  );
}

export function MetricPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: ProjectEvent["tone"];
}) {
  return (
    <HStack align="center" className={`metric-pill tone-${tone}`} gap={1}>
      <AstryxStatusDot
        label={`${label} ${value}`}
        variant={eventDotVariant(tone)}
      />
      <Text color="secondary" type="supporting">
        {label}
      </Text>
      <Text hasTabularNumbers weight="semibold">
        {value}
      </Text>
    </HStack>
  );
}

export function ProjectStatusBadge({
  status,
}: {
  status: ProjectSummary["status"];
}) {
  return <Badge label={status} variant={statusBadgeVariant(status)} />;
}

export function ProjectStatusDot({
  status,
}: {
  status: ProjectSummary["status"];
}) {
  return (
    <AstryxStatusDot
      label={`${status} project`}
      variant={statusDotVariant(status)}
    />
  );
}

export function ActionIcon({
  action,
  isPending,
}: {
  action: SafeAction;
  isPending: boolean;
}) {
  if (isPending) return <InProgress className="spin" size={16} />;
  if (action.kind === "terminal") return <Terminal size={16} />;
  if (action.kind === "process") return <StopOutline size={16} />;
  if (action.kind === "read") return <CodeIcon size={16} />;
  return <Play size={16} />;
}
