import React, { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, FileText, Loader2, X } from "lucide-react";
import { getListInvoicesQueryKey, getGetInvoiceStatsQueryKey } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function UploadZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));
      const res = await fetch("/api/invoices/upload", { 
        method: "POST", 
        body: fd 
      });
      if (!res.ok) {
        throw new Error("Upload fehlgeschlagen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Rechnungen erfolgreich hochgeladen und verarbeitet");
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
      setFilesToUpload([]);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Fehler beim Upload");
    }
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf");
      if (newFiles.length === 0) {
        toast.error("Bitte nur PDF-Dateien hochladen.");
        return;
      }
      setFilesToUpload(prev => [...prev, ...newFiles]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).filter(f => f.type === "application/pdf");
      setFilesToUpload(prev => [...prev, ...newFiles]);
    }
    // reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeFile = (index: number) => {
    setFilesToUpload(prev => prev.filter((_, i) => i !== index));
  };

  const startUpload = () => {
    if (filesToUpload.length > 0) {
      uploadMutation.mutate(filesToUpload);
    }
  };

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden p-6 mb-6">
      <div 
        className={`border-2 border-dashed rounded-md p-10 flex flex-col items-center justify-center transition-colors cursor-pointer
          ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/50"}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadCloud className="h-10 w-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">PDF-Rechnungen hierher ziehen</h3>
        <p className="text-sm text-muted-foreground mt-1">oder klicken, um Dateien auszuwählen</p>
        <input 
          type="file" 
          multiple 
          accept="application/pdf" 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleFileSelect} 
        />
      </div>

      {filesToUpload.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium mb-3">Ausgewählte Dateien ({filesToUpload.length})</h4>
          <ul className="space-y-2 mb-4">
            {filesToUpload.map((file, i) => (
              <li key={i} className="flex items-center justify-between bg-muted/50 p-2 rounded text-sm border border-border/50">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
                  <span className="truncate">{file.name}</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 rounded-full text-muted-foreground hover:text-destructive shrink-0" 
                  onClick={() => removeFile(i)}
                  disabled={uploadMutation.isPending}
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
          
          <div className="flex justify-end">
            <Button 
              onClick={startUpload} 
              disabled={uploadMutation.isPending}
              className="w-full sm:w-auto"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verarbeite...
                </>
              ) : (
                "Hochladen & Extrahieren"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
