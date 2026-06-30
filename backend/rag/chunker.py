from langchain_text_splitters import RecursiveCharacterTextSplitter

def chunk_text(text):

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1500,
        chunk_overlap=100
    )

    return splitter.split_text(text)
