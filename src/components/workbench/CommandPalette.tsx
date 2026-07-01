import { useMemo } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { CommandPalette, CommandPaletteInput } from '@astryxdesign/core/CommandPalette'
import { HStack } from '@astryxdesign/core/HStack'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Text } from '@astryxdesign/core/Text'
import { createStaticSource } from '@astryxdesign/core/Typeahead'
import { VStack } from '@astryxdesign/core/VStack'
import type { LocalSuiteSnapshot, ProjectSummary, RunTarget } from '../../shared/types.ts'
import type { RuntimeActionFixtureId } from './actionStateFixtures.ts'
import {
  buildWorkbenchCommands,
  type WorkbenchCommand,
  type WorkbenchCommandItem,
} from './commandPaletteModel.ts'
import type { DetailTab, WorkbenchDialog } from './types.ts'

export function WorkbenchCommandPalette({
  actionPending,
  currentDialog,
  currentDetailTab,
  isDev,
  isOpen,
  onCommandSelect,
  onOpenChange,
  runtimeActionFixtureId,
  selectedProject,
  selectedRunTarget,
  snapshot,
}: {
  actionPending: boolean
  currentDialog: WorkbenchDialog
  currentDetailTab: DetailTab
  isDev: boolean
  isOpen: boolean
  onCommandSelect: (command: WorkbenchCommand) => void
  onOpenChange: (isOpen: boolean) => void
  runtimeActionFixtureId: RuntimeActionFixtureId | null
  selectedProject: ProjectSummary | null
  selectedRunTarget: RunTarget | null
  snapshot: LocalSuiteSnapshot
}) {
  const commands = useMemo(() => buildWorkbenchCommands({
    actionPending,
    currentDialog,
    currentDetailTab,
    isDev,
    runtimeActionFixtureId,
    selectedProject,
    selectedRunTarget,
    snapshot,
  }), [
    actionPending,
    currentDialog,
    currentDetailTab,
    isDev,
    runtimeActionFixtureId,
    selectedProject,
    selectedRunTarget,
    snapshot,
  ])
  const searchSource = useMemo(() => createStaticSource(commands, {
    keywords: (item) => item.keywords,
  }), [commands])
  const commandById = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands])

  return (
    <CommandPalette<WorkbenchCommandItem>
      emptyBootstrapText="No commands"
      emptySearchText="No matches"
      input={<CommandPaletteInput endContent={<Kbd keys="mod+k" />} placeholder="Run or open" />}
      isOpen={isOpen}
      label="Commands"
      maxHeight="min(32rem, calc(100svh - var(--spacing-8)))"
      onOpenChange={onOpenChange}
      onValueChange={(commandId) => {
        const item = commandById.get(commandId)
        if (!item || item.disabledReason) return
        onCommandSelect(item.command)
      }}
      renderItem={(item) => <CommandPaletteRow item={item} />}
      searchSource={searchSource}
      width="min(44rem, calc(100vw - var(--spacing-4)))"
    />
  )
}

function CommandPaletteRow({ item }: { item: WorkbenchCommandItem }) {
  return (
    <HStack
      align="center"
      className={`command-palette-row${item.disabledReason ? ' is-disabled' : ''}`}
      gap={1.5}
      justify="between"
      width="100%"
    >
      <VStack className="command-palette-copy" gap={0}>
        <HStack align="center" gap={1} wrap="wrap">
          <Text maxLines={1} weight="semibold">{item.label}</Text>
          {item.badge ? <Badge label={item.badge.label} variant={item.badge.variant} /> : null}
        </HStack>
        <Text color={item.disabledReason ? 'disabled' : 'secondary'} maxLines={1} type="supporting">
          {item.disabledReason ?? item.detail}
        </Text>
      </VStack>
      {item.shortcut ? (
        <Kbd keys={item.shortcut} />
      ) : item.meta ? (
        <Text className="command-palette-meta" color="secondary" maxLines={1} type="supporting">
          {item.meta}
        </Text>
      ) : null}
    </HStack>
  )
}
