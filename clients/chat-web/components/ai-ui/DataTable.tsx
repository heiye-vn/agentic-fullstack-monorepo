"use client";

import React, { useState } from "react";
import type { TableComponent, UIAction } from "@/types/ui-protocol";

interface DataTableProps {
  data: TableComponent;
  onAction?: (action: UIAction) => void;
  disabled?: boolean;
}

export const DataTable: React.FC<DataTableProps> = ({
  data,
  onAction,
  disabled = false,
}) => {
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  const handleRowClick = (rowIndex: number, row: Record<string, unknown>) => {
    if (disabled || !data.selectable) return;
    setSelectedRowIndex(rowIndex);
    onAction?.({
      componentType: "table",
      type: "selection",
      payload: {
        type: "row_select",
        rowIndex,
        rowData: row,
      },
    });
  };

  return (
    <div className="w-full rounded-xl border border-neutral-800 bg-neutral-950/80 p-4 shadow-lg backdrop-blur-sm text-left">
      {data.title && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold tracking-wide text-neutral-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            {data.title}
          </h3>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-800 custom-scrollbar">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900/80 text-neutral-400">
              {data.selectable && (
                <th className="px-3 py-2.5 w-10 text-center">#</th>
              )}
              {data.columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className="px-3.5 py-2.5 font-medium whitespace-nowrap"
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60 text-neutral-200">
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={data.columns.length + (data.selectable ? 1 : 0)}
                  className="px-4 py-6 text-center text-xs text-neutral-500"
                >
                  暂无数据记录
                </td>
              </tr>
            ) : (
              data.rows.map((row, rIdx) => {
                const isSelected = selectedRowIndex === rIdx;

                return (
                  <tr
                    key={rIdx}
                    onClick={() => handleRowClick(rIdx, row)}
                    className={`transition-colors ${
                      data.selectable ? "cursor-pointer" : ""
                    } ${
                      isSelected
                        ? "bg-indigo-950/40 text-white"
                        : rIdx % 2 === 1
                          ? "bg-neutral-900/30 hover:bg-neutral-900/60"
                          : "hover:bg-neutral-900/60"
                    }`}
                  >
                    {data.selectable && (
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="radio"
                          name={`table-row-${data.title || "select"}`}
                          checked={isSelected}
                          disabled={disabled}
                          onChange={() => handleRowClick(rIdx, row)}
                          className="accent-indigo-500 cursor-pointer"
                        />
                      </td>
                    )}
                    {data.columns.map((col) => {
                      const val = row[col.key];
                      return (
                        <td
                          key={col.key}
                          className="px-3.5 py-2.5 whitespace-nowrap text-neutral-300"
                        >
                          {val !== undefined && val !== null ? String(val) : "-"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
