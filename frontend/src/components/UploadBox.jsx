import { useState } from "react";
import { Upload, FileText, Loader } from "lucide-react";
import "./UploadBox.css";

function UploadBox({
  file,
  setFile,
  uploadPdf,
  uploadStatus,
  uploading,
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

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type === "application/pdf") {
      setFile(droppedFile);
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
            Add your lecture slides, notes, or textbook chapters (PDFs) to start querying them.
          </p>
        </div>
      </div>

      <div className="upload-dropzone">
        <div className="button-group">
          <label className="file-picker">
            <FileText size={16} style={{ marginRight: "8px" }} />
            {file ? "Change PDF" : "Choose PDF"}
            <input
              type="file"
              accept=".pdf"
              hidden
              onChange={(e) => setFile(e.target.files[0])}
              disabled={uploading}
            />
          </label>

          <button
            className="upload-btn"
            onClick={uploadPdf}
            disabled={uploading || !file}
          >
            {uploading ? (
              <>
                <Loader className="animate-spin" size={16} style={{ marginRight: "8px" }} />
                Indexing...
              </>
            ) : (
              <>
                <Upload size={16} style={{ marginRight: "8px" }} />
                Build Base
              </>
            )}
          </button>
        </div>

        <div className="upload-hint">or drag and drop a PDF anywhere in this card</div>
      </div>

      {file && (
        <div className="selected-file">
          <FileText size={14} />
          <span>{file.name}</span>
        </div>
      )}

      {uploadStatus && (
        <div className="upload-status">
          {uploadStatus}
        </div>
      )}
    </div>
  );
}

export default UploadBox;
