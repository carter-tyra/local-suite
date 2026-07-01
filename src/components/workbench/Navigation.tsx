import type { Ref } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Section } from "@astryxdesign/core/Section";
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { VStack } from "@astryxdesign/core/VStack";
import {
  InProgress,
  Flow,
  MacCommand as CommandIcon,
  Renew,
  Search,
  Security,
  Warning,
} from "@carbon/icons-react";
import { countListenersByFilter } from "../../listenerFilters.ts";
import { summarizeUnresolvedListeners } from "../../portCorrelations.ts";
import { summarizeRunningProjects } from "../../runtimeSummaries.ts";
import { formatTime } from "../../format.ts";
import type { LocalSuiteSnapshot } from "../../shared/types.ts";
import { MetricPill } from "./shared.tsx";
import type { WorkbenchDialog } from "./types.ts";

export function WorkbenchTopNav({
  snapshot,
  searchValue,
  isFetching,
  commandPaletteTriggerRef,
  onCommandPaletteOpen,
  onSearchChange,
  onRefresh,
  onDialogOpen,
}: {
  commandPaletteTriggerRef: Ref<HTMLButtonElement>;
  snapshot: LocalSuiteSnapshot | null;
  searchValue: string;
  isFetching: boolean;
  onCommandPaletteOpen: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onDialogOpen: (dialog: WorkbenchDialog) => void;
}) {
  const runningCount = snapshot
    ? summarizeRunningProjects(snapshot.projects).length
    : 0;
  const publicListeners = snapshot
    ? countListenersByFilter(snapshot.listeners)["external-public"]
    : 0;

  return (
    <TopNav
      className="workbench-topnav"
      centerContent={
        <TextInput
          hasClear
          isLabelHidden
          label="Find project"
          onChange={onSearchChange}
          placeholder="Find project"
          size="sm"
          startIcon={<Search size={16} />}
          value={searchValue}
        />
      }
      endContent={
        <HStack align="center" gap={1} wrap="wrap">
          {snapshot ? (
            <>
              <MetricPill
                label="running"
                tone="success"
                value={String(runningCount)}
              />
              <MetricPill
                label="public"
                tone={publicListeners ? "error" : "success"}
                value={String(publicListeners)}
              />
              <MetricPill
                label="dirty"
                tone={snapshot.summary.dirtyRepos ? "warning" : "neutral"}
                value={String(snapshot.summary.dirtyRepos)}
              />
              <MetricPill
                label="snapshot"
                value={formatTime(snapshot.generatedAt)}
              />
            </>
          ) : null}
          <Button
            icon={<CommandIcon size={16} />}
            label="Commands"
            onClick={onCommandPaletteOpen}
            ref={commandPaletteTriggerRef}
            size="sm"
            variant="secondary"
          />
          <IconButton
            icon={
              isFetching ? (
                <InProgress className="spin" size={16} />
              ) : (
                <Renew size={16} />
              )
            }
            isDisabled={isFetching}
            label="Refresh"
            onClick={onRefresh}
            size="sm"
            tooltip="Refresh"
            variant="ghost"
          />
          <Button
            label="Ports"
            onClick={() => onDialogOpen("ports")}
            size="sm"
            variant="secondary"
          />
        </HStack>
      }
      heading={
        <TopNavHeading
          heading="Local Suite"
          logo={<Flow size={24} />}
          subheading="v1 control plane"
        />
      }
      label="Local Suite"
    />
  );
}

export function WorkbenchSideNav({
  snapshot,
  selectedDialog,
  onDialogOpen,
}: {
  snapshot: LocalSuiteSnapshot | null;
  selectedDialog: WorkbenchDialog;
  onDialogOpen: (dialog: WorkbenchDialog) => void;
}) {
  const unresolved = snapshot
    ? summarizeUnresolvedListeners(snapshot.listeners).length
    : 0;
  const exceptions = snapshot
    ? snapshot.summary.attentionProjects + unresolved
    : 0;

  return (
    <SideNav
      className="workbench-sidenav"
      footer={
        <VStack gap={1}>
          <HStack align="center" gap={1}>
            <Security size={16} />
            <Text color="secondary" type="supporting">
              No env files read
            </Text>
          </HStack>
        </VStack>
      }
      header={""}
    >
      <SideNavSection title="Views">
        <SideNavItem
          endContent={
            exceptions ? (
              <Badge label={String(exceptions)} variant="warning" />
            ) : null
          }
          isSelected={!selectedDialog}
          label="Exceptions"
          onClick={() => onDialogOpen(null)}
        />
        <SideNavItem
          endContent={
            snapshot ? (
              <Badge
                label={String(snapshot.projects.length)}
                variant="neutral"
              />
            ) : null
          }
          isSelected={selectedDialog === "fleet"}
          label="Projects"
          onClick={() => onDialogOpen("fleet")}
        />
        <SideNavItem
          endContent={
            unresolved ? (
              <Badge label={String(unresolved)} variant="warning" />
            ) : null
          }
          isSelected={selectedDialog === "ports"}
          label="Ports"
          onClick={() => onDialogOpen("ports")}
        />
        <SideNavItem
          isSelected={selectedDialog === "history"}
          label="History"
          onClick={() => onDialogOpen("history")}
        />
        <SideNavItem
          isSelected={selectedDialog === "git"}
          label="Git"
          onClick={() => onDialogOpen("git")}
        />
        <SideNavItem
          isSelected={selectedDialog === "docker"}
          label="Docker"
          onClick={() => onDialogOpen("docker")}
        />
      </SideNavSection>
    </SideNav>
  );
}

export function LoadingState() {
  return (
    <Section className="workbench-state" padding={6} variant="transparent">
      <HStack align="center" gap={2} justify="center">
        <InProgress className="spin" size={20} />
        <Text color="secondary">Loading local state</Text>
      </HStack>
    </Section>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Section className="workbench-state" padding={6} variant="transparent">
      <EmptyState
        description={message}
        headingLevel={2}
        icon={<Warning size={24} />}
        isCompact
        title="Snapshot failed"
      />
    </Section>
  );
}
