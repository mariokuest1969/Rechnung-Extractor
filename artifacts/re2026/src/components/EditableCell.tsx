import React, { useState, useEffect, useRef, useId } from "react";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";

interface EditableCellProps {
  value: string | number | null | undefined;
  onSave: (val: string | null) => void | Promise<unknown>;
  validate?: (val: string) => string | undefined;
  describeError?: (error: unknown) => string;
  type?: "text" | "number" | "date";
  placeholder?: string;
  className?: string;
}

export function EditableCell({ value, onSave, validate, describeError, type = "text", placeholder, className = "" }: EditableCellProps) {
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const errorId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setLocalValue(value != null ? String(value) : "");
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (saving.current) return;
    const validationError = validate?.(localValue);
    setError(validationError);
    if (validationError) return;
    const trimmed = localValue.trim();
    try {
      saving.current = true;
      if (trimmed !== (value != null ? String(value) : "")) {
        await onSave(trimmed === "" ? null : trimmed);
      }
      setIsEditing(false);
    } catch (error) {
      setError(describeError?.(error) ?? "Nicht gespeichert. Bitte erneut versuchen.");
    } finally {
      saving.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setError(undefined);
      setLocalValue(value != null ? String(value) : "");
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div><Input
        ref={inputRef}
        type={type === "date" ? "date" : type === "number" ? "text" : "text"} // use text for number to allow commas
        value={localValue}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => { setLocalValue(e.target.value); setError(undefined); }}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        lang={type === "date" ? "de-DE" : undefined}
        className={`h-8 px-2 text-sm font-sans ${type === "date" ? "min-w-[150px] whitespace-nowrap" : ""} ${className}`}
      />{error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}</div>
    );
  }

  return (
    <div 
      className={`min-h-[2rem] flex items-center px-2 py-1 -mx-2 rounded hover:bg-muted/50 cursor-text transition-colors border border-transparent hover:border-border/50 text-sm ${className}`}
      onClick={() => setIsEditing(true)}
    >
      {value != null && String(value).trim() !== "" ? (
        <span className={type === "date" ? "whitespace-nowrap" : undefined}>{type === "date" ? formatDate(String(value)) : String(value)}</span>
      ) : (
        <span className="text-muted-foreground opacity-50 italic">{placeholder || "Leer"}</span>
      )}
    </div>
  );
}
