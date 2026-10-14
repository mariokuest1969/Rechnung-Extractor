import React, { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, FileText, Loader2, X, Eye } from "lucide-react";
import {
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
  InvoicePreview,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UploadReviewDialog } from "./UploadReviewDialog";
import { extractPreviews } from "@/lib/upload-preview";

export function UploadZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [previews, setPreviews] = useState<InvoicePreview[] | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isExtracting || reviewOpen) return;
    const newFiles = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf");
    if (newFiles.length === 0) { toast.error("Bitte nur PDF-Dateien hochladen."); return; }
    setFilesToUpload(prev => [...prev, ...newFiles]);
    setPreviews(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isExtracting || reviewOpen) return;
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).filter(f => f.type === "application/pdf");
      setFilesToUpload(prev => [...prev, ...newFiles]);
      setPreviews(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFilesToUpload(prev => prev.filter((_, i) => i !== index));
    setPreviews(null);
  };

  // Step 1: Extract preview — open review dialog
  const startExtract = async () => {
    if (filesToUpload.length === 0) return;
    if (previews) { setReviewOpen(true); return; }
    setIsExtracting(true);
    try {
      const data = await extractPreviews(filesToUpload);
      setPreviews(data);
      setReviewOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fehler bei der Extraktion");
    } finally {
      setIsExtracting(false);
    }
  };

  const retryFile = async (index: number) => {
    if (retryingIndex !== null || previews?.[index]?.status !== "error") return;
    setRetryingIndex(index);
    try {
      const [result] = await extractPreviews([filesToUpload[index]]);
      setPreviews(previous => previous?.map((preview, i) => i === index ? result : preview) ?? null);
    } finally {
      setRetryingIndex(null);
    }
  };

  const handleReviewClose = (saved: boolean) => {
    setReviewOpen(false);
    if (saved) {
      setFilesToUpload([]);
      setPreviews(null);
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
    }
  };

  return (
    <>
      <div className="bg-card rounded-lg border border-border overflow-hidden p-6 mb-6">
        <div
          className={`border-2 border-dashed rounded-md p-10 flex flex-col items-center justify-center transition-colors cursor-pointer
            ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/50"}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isExtracting && !reviewOpen && fileInputRef.current?.click()}
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
            disabled={isExtracting || reviewOpen}
          />
        </div>

        {filesToUpload.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-medium mb-3">
              Ausgewählte Dateien ({filesToUpload.length})
            </h4>
            <ul className="space-y-2 mb-4">
              {filesToUpload.map((file, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between bg-muted/50 p-2 rounded text-sm border border-border/50"
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
                    <span className="truncate">{file.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-full text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeFile(i)}
                    disabled={isExtracting}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex justify-end gap-2">
              <Button
                onClick={startExtract}
                disabled={isExtracting}
                className="w-full sm:w-auto"
              >
                {isExtracting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />KI extrahiert…</>
                ) : (
                  <><Eye className="mr-2 h-4 w-4" />{previews ? "Vorschau öffnen" : "Extrahieren & Prüfen"}</>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {previews && (
        <UploadReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          onSaved={() => handleReviewClose(true)}
          previews={previews}
          onRetry={retryFile}
          retryingIndex={retryingIndex}
        />
      )}
    </>
  );
}
