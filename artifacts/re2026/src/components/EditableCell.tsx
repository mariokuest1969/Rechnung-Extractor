import React, { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

interface EditableCellProps {
  value: string | number | null | undefined;
  onSave: (val: string | null) => void;
  type?: "text" | "number" | "date";
  placeholder?: string;
  className?: string;
}

export function EditableCell({ value, onSave, type = "text", placeholder, className = "" }: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(value != null ? String(value) : "");
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = () => {
    setIsEditing(false);
    const trimmed = localValue.trim();
    if (trimmed !== (value != null ? String(value) : "")) {
      onSave(trimmed === "" ? null : trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setLocalValue(value != null ? String(value) : "");
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type={type === "date" ? "date" : type === "number" ? "text" : "text"} // use text for number to allow commas
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`h-8 px-2 text-sm font-sans ${className}`}
      />
    );
  }

  return (
    <div 
      className={`min-h-[2rem] flex items-center px-2 py-1 -mx-2 rounded hover:bg-muted/50 cursor-text transition-colors border border-transparent hover:border-border/50 text-sm ${className}`}
      onClick={() => setIsEditing(true)}
    >
      {value != null && String(value).trim() !== "" ? (
        <span>{type === "number" || type === "date" ? String(value) : String(value)}</span>
      ) : (
        <span className="text-muted-foreground opacity-50 italic">{placeholder || "Leer"}</span>
      )}
    </div>
  );
}
