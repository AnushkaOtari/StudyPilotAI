function UploadBox({
  file,
  setFile,
  uploadPdf,
  uploadStatus,
  uploading,
}) {
  return (
    <div className="upload-box">

      <h2>Upload Study Notes</h2>

      <p>
        Upload your PDF and StudyPilot will build an AI knowledge base.
      </p>

      <div className="button-group">

        <label className="file-picker">
          Choose PDF
          <input
            type="file"
            accept=".pdf"
            hidden
            onChange={(e) => setFile(e.target.files[0])}
          />
        </label>

        <button
          className="upload-btn"
          onClick={uploadPdf}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Upload PDF"}
        </button>

      </div>

      {file && (
        <div className="selected-file">
          📄 {file.name}
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