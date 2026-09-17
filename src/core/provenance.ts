// #16: AI-origin files carry a standard embedded marker, written when the image is published.
// IPTC's "composite with trained algorithmic media" is the digital source type for a real photo
// (the product) combined with AI-generated content (the scene) — which is exactly an image edit.

const COMPOSITE_AI = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function aiProvenanceXmp(p: { sku: string; model: string; approvedAt: Date; imageId: string }) {
  const note = escapeXml(`AI-generated scene (Luma ${p.model} image edit) around the product photo of ${p.sku}.`);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    Iptc4xmpExt:DigitalSourceType="${COMPOSITE_AI}"
    xmp:CreatorTool="Luma ${escapeXml(p.model)}"
    xmp:CreateDate="${p.approvedAt.toISOString()}">
   <dc:identifier>${escapeXml(p.imageId)}</dc:identifier>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${note}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
