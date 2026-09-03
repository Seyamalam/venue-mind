import { useMemo, useState, type ReactNode, type UIEvent } from "react";

interface VirtualListProps<Item> {
  readonly items: readonly Item[];
  readonly estimateSize: number;
  readonly renderItem: (item: Item, index: number) => ReactNode;
  readonly getKey: (item: Item) => string;
  readonly className?: string;
  readonly overscan?: number;
  readonly threshold?: number;
  readonly role?: "list" | "feed";
  readonly ariaLabel?: string;
}

export function VirtualList<Item>({
  items,
  estimateSize,
  renderItem,
  getKey,
  className,
  overscan = 5,
  threshold = 50,
  role,
  ariaLabel,
}: VirtualListProps<Item>) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  const range = useMemo(() => {
    const first = Math.max(0, Math.floor(viewport.scrollTop / estimateSize) - overscan);
    const count = Math.ceil(viewport.height / estimateSize) + overscan * 2;
    return { first, last: Math.min(items.length, first + count) };
  }, [estimateSize, items.length, overscan, viewport.height, viewport.scrollTop]);
  if (items.length <= threshold)
    return (
      <div className={className} role={role} aria-label={ariaLabel}>
        {items.map(renderItem)}
      </div>
    );
  const visibleItems = items.slice(range.first, range.last);
  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
  };
  return (
    <div
      className={`${className ?? ""} virtual-list`}
      role={role}
      aria-label={ariaLabel}
      onScroll={onScroll}
      style={{ overflowY: "auto", position: "relative" }}
    >
      <div className="virtual-list-space" style={{ height: items.length * estimateSize, position: "relative" }}>
        {visibleItems.map((item, offset) => {
          const index = range.first + offset;
          return (
            <div
              className="virtual-list-item"
              key={getKey(item)}
              style={{ height: estimateSize, left: 0, position: "absolute", right: 0, top: index * estimateSize }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
