import * as React from "react";

/**
 * Stand-in for `@legendapp/list/react` under jsdom.
 *
 * The real list measures its scroller to decide what to mount, and jsdom
 * reports every box as zero — it would render no rows at all. This renders the
 * whole `data` array and exposes `onEndReached` as a "scroll to end" button, so
 * a test can drive paging without a layout engine.
 *
 * Like the real list, a mounted row re-renders when its item or `extraData`
 * changes, not when `renderItem` does.
 *
 * Use as: `vi.mock("@legendapp/list/react", () => import("@/test/legendList"))`.
 */
type RenderItem = (info: { item: unknown; index: number }) => React.ReactNode;

const Row = React.memo(
  function Row({
    item,
    index,
    renderItem,
  }: {
    item: unknown;
    index: number;
    renderItem: RenderItem;
    extraData: unknown;
  }) {
    return <>{renderItem({ index, item })}</>;
  },
  (prev, next) =>
    prev.item === next.item && prev.index === next.index && prev.extraData === next.extraData,
);

export function LegendList({
  data,
  renderItem,
  keyExtractor,
  extraData,
  onEndReached,
  ListFooterComponent,
}: {
  data: readonly unknown[];
  renderItem: RenderItem;
  keyExtractor: (item: unknown, index: number) => string;
  extraData?: unknown;
  onEndReached?: () => void;
  ListFooterComponent?: React.ReactNode;
}) {
  return (
    <div>
      {data.map((item, index) => (
        <div key={keyExtractor(item, index)}>
          <Row item={item} index={index} renderItem={renderItem} extraData={extraData} />
        </div>
      ))}
      <button type="button" onClick={() => onEndReached?.()}>
        scroll to end
      </button>
      {ListFooterComponent}
    </div>
  );
}
