export function isWordLikeFile(file: File): boolean {
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return (
        name.endsWith('.pdf') ||
        name.endsWith('.doc') ||
        name.endsWith('.docx') ||
        name.endsWith('.odt') ||
        name.endsWith('.txt') ||
        type.includes('pdf') ||
        type.includes('word') ||
        type.includes('opendocument.text') ||
        type === 'text/plain'
    );
}
