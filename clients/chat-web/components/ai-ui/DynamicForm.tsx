"use client";

import React, { useState } from "react";
import type { FormComponent, UIAction } from "@/types/ui-protocol";

interface DynamicFormProps {
  data: FormComponent;
  onAction?: (action: UIAction) => void;
  disabled?: boolean;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({
  data,
  onAction,
  disabled = false,
}) => {
  const initialValues: Record<string, string | number | boolean> = {};
  data.fields.forEach((field) => {
    initialValues[field.name] = field.defaultValue ?? "";
  });

  const [formData, setFormData] = useState<Record<string, string | number | boolean>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (name: string, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || submitting) return;

    // 校验必填项
    const newErrors: Record<string, string> = {};
    data.fields.forEach((f) => {
      const val = formData[f.name];
      if (f.required && (val === undefined || val === null || String(val).trim() === "")) {
        newErrors[f.name] = `${f.label}不能为空`;
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    onAction?.({
      componentType: "form",
      actionKey: data.actionKey || "submit_form",
      type: "form_submit",
      payload: {
        type: "submit",
        formData: formData as Record<string, unknown>,
      },
    });
  };

  const handleCancel = () => {
    if (disabled || submitting) return;
    onAction?.({
      componentType: "form",
      actionKey: "cancel_form",
      type: "form_submit",
      payload: {
        type: "cancel",
      },
    });
  };

  return (
    <div className="w-full rounded-2xl border border-neutral-800/90 bg-[#121212] p-6 shadow-2xl transition-all">
      {data.title && (
        <div className="mb-5">
          <h3 className="text-sm sm:text-base font-semibold text-neutral-100">
            {data.title}
          </h3>
          {data.description && (
            <p className="mt-1 text-xs text-neutral-400">{data.description}</p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {data.fields.map((field) => {
          const fieldError = errors[field.name];
          const val = (formData[field.name] as string | number | undefined) ?? "";

          // 特殊支持 checkbox 类型
          if (field.type === ("checkbox" as any)) {
            return (
              <div key={field.name} className="flex items-center gap-3 pt-2">
                <div className="w-28 shrink-0" />
                <label className="flex items-center gap-2.5 text-xs text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(formData[field.name])}
                    onChange={(e) => handleChange(field.name, e.target.checked)}
                    disabled={disabled || submitting}
                    className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0"
                  />
                  <span>{field.label}</span>
                </label>
              </div>
            );
          }

          return (
            <div key={field.name} className="flex flex-col sm:flex-row sm:items-start gap-3">
              {/* 左侧统一标签 (图 4 格式) */}
              <label className="w-28 shrink-0 text-xs sm:text-sm font-medium text-neutral-300 pt-2.5 flex items-center">
                <span>{field.label}</span>
                {field.required && (
                  <span className="ml-1 text-red-500 font-bold">*</span>
                )}
              </label>

              {/* 右侧输入容器 */}
              <div className="flex-1 w-full space-y-1">
                {field.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={val}
                    disabled={disabled || submitting}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder={field.placeholder || `请填写${field.label}`}
                    className={`w-full rounded-xl border bg-[#181818] p-3 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 transition focus:outline-none focus:border-neutral-600 resize-none ${
                      fieldError
                        ? "border-rose-500/80 focus:border-rose-500"
                        : "border-neutral-800/80"
                    } ${disabled || submitting ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                ) : field.type === "select" ? (
                  <div className="relative">
                    <select
                      value={val}
                      disabled={disabled || submitting}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      className={`w-full appearance-none rounded-xl border bg-[#181818] px-3.5 py-2.5 text-xs sm:text-sm text-neutral-100 transition focus:outline-none focus:border-neutral-600 ${
                        fieldError
                          ? "border-rose-500/80 focus:border-rose-500"
                          : "border-neutral-800/80"
                      } ${disabled || submitting ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <option value="" disabled className="bg-neutral-900 text-neutral-500">
                        {field.placeholder || `请选择${field.label}`}
                      </option>
                      {field.options?.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          className="bg-neutral-900 text-neutral-200"
                        >
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-neutral-400">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                ) : field.type === "date" ? (
                  <div className="relative">
                    <input
                      type="date"
                      value={val}
                      disabled={disabled || submitting}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      placeholder={field.placeholder || "年 / 月 / 日"}
                      className={`w-full rounded-xl border bg-[#181818] px-3.5 py-2.5 text-xs sm:text-sm text-neutral-100 transition focus:outline-none focus:border-neutral-600 ${
                        fieldError
                          ? "border-rose-500/80 focus:border-rose-500"
                          : "border-neutral-800/80"
                      } ${disabled || submitting ? "opacity-50 cursor-not-allowed" : ""}`}
                    />
                  </div>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    value={val}
                    disabled={disabled || submitting}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder={field.placeholder || `请输入${field.label}`}
                    className={`w-full rounded-xl border bg-[#181818] px-3.5 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 transition focus:outline-none focus:border-neutral-600 ${
                      fieldError
                        ? "border-rose-500/80 focus:border-rose-500"
                        : "border-neutral-800/80"
                    } ${disabled || submitting ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                )}

                {fieldError && (
                  <p className="text-[11px] text-rose-400">{fieldError}</p>
                )}
              </div>
            </div>
          );
        })}

        {/* 是否涉及跨部门协作 (如果未在 fields 里定义，作为图 4 常见表单字段补充) */}
        {!data.fields.some((f) => f.name === "crossDepartment") && (
          <div className="flex items-center gap-3 pt-1">
            <div className="w-28 shrink-0" />
            <label className="flex items-center gap-2.5 text-xs text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(formData["crossDepartment"])}
                onChange={(e) => handleChange("crossDepartment", e.target.checked)}
                disabled={disabled || submitting}
                className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0"
              />
              <span>是否涉及跨部门协作</span>
            </label>
          </div>
        )}

        {/* 底部操作栏 (图 4 提交与取消按钮) */}
        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-neutral-900/80">
          <button
            type="button"
            disabled={disabled || submitting}
            onClick={handleCancel}
            className="px-4 py-2 rounded-xl text-xs text-neutral-400 hover:text-white transition cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={disabled || submitting}
            className="px-6 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_14px_rgba(37,99,235,0.4)] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "提交中..." : "提交"}
          </button>
        </div>
      </form>
    </div>
  );
};
