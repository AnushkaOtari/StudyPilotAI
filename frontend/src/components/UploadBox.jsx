import { Upload, FileText, Loader } from "lucide-react";

function UploadBox({
  file,
  setFile,
  uploadPdf,
  uploadStatus,
  uploading,
}) {
  return (
    <div className="upload-box animate-fade-in">
      <h2>Upload Study Materials</h2>
      <p>
        Add your lecture slides, notes, or textbook chapters (PDFs) to start querying them.
      </p>

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