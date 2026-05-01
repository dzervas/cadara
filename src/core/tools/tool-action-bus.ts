import type {
	ToolEventMap,
	ToolGroupEventMap,
	ToolGroupId,
	ToolId,
} from "@/core/tools/tool-registry";
import { getToolById } from "@/core/tools/tool-registry";
import type { ToolTriggerMetadata, ToolbarMode } from "@/core/tools/schema";

type ToolHandler<TToolId extends ToolId> = (event: ToolEventMap[TToolId]) => void;
type GroupHandler<TGroupId extends ToolGroupId> = (event: ToolGroupEventMap[TGroupId]) => void;

// An abstract class that allows subscribing to tool and group of tools events, as well as triggering them.
export class ToolActionBus {
	private readonly toolHandlers = new Map<ToolId, Set<ToolHandler<ToolId>>>();
	private readonly groupHandlers = new Map<ToolGroupId, Set<GroupHandler<ToolGroupId>>>();

	subscribeToTool<TToolId extends ToolId>(toolId: TToolId, handler: ToolHandler<TToolId>) {
		const handlers = this.toolHandlers.get(toolId) ?? new Set<ToolHandler<ToolId>>();
		handlers.add(handler as ToolHandler<ToolId>);
		this.toolHandlers.set(toolId, handlers);

		return () => {
			handlers.delete(handler as ToolHandler<ToolId>);
			if (handlers.size === 0) {
				this.toolHandlers.delete(toolId);
			}
		};
	}

	subscribeToGroup<TGroupId extends ToolGroupId>(
		groupId: TGroupId,
		handler: GroupHandler<TGroupId>,
	) {
		const handlers = this.groupHandlers.get(groupId) ?? new Set<GroupHandler<ToolGroupId>>();
		handlers.add(handler as GroupHandler<ToolGroupId>);
		this.groupHandlers.set(groupId, handlers);

		return () => {
			handlers.delete(handler as GroupHandler<ToolGroupId>);
			if (handlers.size === 0) {
				this.groupHandlers.delete(groupId);
			}
		};
	}

	triggerTool<TToolId extends ToolId>(
		toolId: TToolId,
		mode: ToolbarMode,
		metadata: ToolTriggerMetadata,
	) {
		const tool = getToolById(toolId);
		const timestamp = Date.now();

		const groupEvent = {
			groupId: tool.group,
			toolId: tool.id,
			mode,
			source: metadata.source,
			timestamp,
		} as ToolGroupEventMap[typeof tool.group];

		this.groupHandlers.get(tool.group)?.forEach((handler) => {
			handler(groupEvent);
		});

		const toolEvent = {
			toolId: tool.id,
			groupId: tool.group,
			mode,
			source: metadata.source,
			timestamp,
			definition: tool,
		} as ToolEventMap[TToolId];

		this.toolHandlers.get(toolId)?.forEach((handler) => {
			handler(toolEvent);
		});
	}
}

export function createToolActionBus() {
	return new ToolActionBus();
}
