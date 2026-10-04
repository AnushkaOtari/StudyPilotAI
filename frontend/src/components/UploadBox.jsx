import { useState } from "react";
import { Upload, FileText, Loader, CheckCircle2, Clock, XCircle, X } from "lucide-react";
import "./UploadBox.css";

function UploadBox({
  files = [],
  setFiles,
  uploadPdf,
  uploadStatus,
  uploading,
  queueJobs = [],
}) {
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!uploading) setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragActive(false);
    if (uploading) return;

    const droppedFiles = Array.from(e.dataTransfer.files || []).filter(
      (f) => f.name.toLowerCase().endsWith(".pdf")
    );
    if (droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (selected.length > 0) {
      setFiles((prev) => [...prev, ...selected]);
    }
  };

  const removeFile = (indexToRemove) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const renderStatusBadge = (status) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="job-status-tag status-completed">
            <CheckCircle2 size={13} /> Completed
          </span>
        );
      case "PROCESSING":
        return (
          <span className="job-status-tag status-processing">
            <Loader className="animate-spin" size={13} /> Processing
          </span>
        );
      case "WAITING":
        return (
          <span className="job-status-tag status-waiting">
            <Clock size={13} /> Waiting
          </span>
        );
      case "FAILED":
        return (
          <span className="job-status-tag status-failed">
            <XCircle size={13} /> Failed
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`upload-box animate-fade-in ${isDragActive ? "drag-active" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="upload-box-top">
        <div className="upload-icon-wrap">
          <Upload size={24} />
        </div>
        <div className="upload-box-copy">
          <h2>Upload Study Materials</h2>
          <p>
            Add lecture slides, notes, or textbook chapters (PDFs) to start querying them. You can select multiple PDFs.
          </p>
        </div>
      </div>

      <div className="upload-dropzone">
        <div className="button-group">
          <label className="file-picker">
            <FileText size={16} style={{ marginRight: "8px" }} />
            {files.length > 0 ? "Add More PDFs" : "Choose PDFs"}
            <input
              type="file"
              multiple
              accept=".pdf"
              hidden
              onChange={handleFileChange}
              disabled={uploading}
            />
          </label>

          <button
            className="upload-btn"
            onClick={uploadPdf}
            disabled={uploading || files.length === 0}
          >
            {uploading ? (
              <>
                <Loader className="animate-spin" size={16} style={{ marginRight: "8px" }} />
                Processing Queue...
              </>
            ) : (
              <>
                <Upload size={16} style={{ marginRight: "8px" }} />
                {files.length > 1
                  ? `Upload ${files.length} PDFs`
                  : files.length === 1
                  ? "Upload 1 PDF"
                  : "Build Base"}
              </>
            )}
          </button>
        </div>

        <div className="upload-hint">or drag and drop multiple PDFs anywhere in this card</div>
      </div>

      {files.length > 0 && (
        <div className="selected-files-container">
          <div className="selected-files-header">
            <span>Selected Files ({files.length}):</span>
            {!uploading && (
              <button
                type="button"
                className="clear-all-btn"
                onClick={() => setFiles([])}
              >
                Clear all
              </button>
            )}
          </div>
          <div className="selected-files-list">
            {files.map((f, idx) => (
              <div key={idx} className="selected-file-chip">
                <FileText size={14} />
                <span className="file-chip-name">{f.name}</span>
                {!uploading && (
                  <button
                    type="button"
                    className="remove-chip-btn"
                    onClick={() => removeFile(idx)}
                    title="Remove file"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Queue Job Processing Statuses */}
      {queueJobs.length > 0 && (
        <div className="queue-status-container">
          <div className="queue-status-title">
            <span>FIFO Document Queue Status</span>
          </div>
          <div className="queue-jobs-list">
            {queueJobs.map((job, idx) => (
              <div key={job.job_id || idx} className={`queue-job-item state-${job.status.toLowerCase()}`}>
                <div className="job-file-info">
                  <FileText size={14} />
                  <span className="job-filename">{job.filename}</span>
                </div>
                {renderStatusBadge(job.status)}
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadStatus && queueJobs.length === 0 && (
        <div className="upload-status">{uploadStatus}</div>
      )}
    </div>
  );
}

export default UploadBox;
