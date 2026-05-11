import {
  useEffect,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  clampWorkbenchSidebarWidth,
  getWorkbenchSidebarWidthFromPointer,
} from "@/app/workbench/shell/workbench-shell-layout";

interface WorkbenchSidebarResizeInput {
  setLeftSidebarWidth: Dispatch<SetStateAction<number>>;
  shellFrameRef: RefObject<HTMLDivElement | null>;
}

export function useWorkbenchSidebarResize({
  setLeftSidebarWidth,
  shellFrameRef,
}: WorkbenchSidebarResizeInput) {
  const handleSidebarResizeStart = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const container = shellFrameRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();

    const containerRect = container.getBoundingClientRect();
    const updateSidebarWidth = (pointerClientX: number) => {
      setLeftSidebarWidth((current) => {
        const nextWidth = getWorkbenchSidebarWidthFromPointer(
          pointerClientX,
          containerRect.left,
          containerRect.width,
        );

        return nextWidth === current ? current : nextWidth;
      });
    };

    updateSidebarWidth(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateSidebarWidth(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  useEffect(() => {
    const container = shellFrameRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      setLeftSidebarWidth((current) =>
        clampWorkbenchSidebarWidth(
          current,
          container.getBoundingClientRect().width,
        ),
      );
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [setLeftSidebarWidth, shellFrameRef]);

  return {
    handleSidebarResizeStart,
  };
}
