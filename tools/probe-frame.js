(function () {
  var card = document.querySelector('.post');
  if (!card) return 'no post';
  var frame = card.querySelector('.photo-frame');
  var img = frame ? frame.querySelector('img') : null;
  var box = frame ? frame.getBoundingClientRect() : null;
  var ir = img ? img.getBoundingClientRect() : null;
  var layers = frame ? [].map.call(frame.querySelectorAll('.layer'), function (l) {
    var r = l.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), src: l.src.split('/').pop() };
  }) : [];
  return JSON.stringify({
    frameClass: frame ? frame.className : null,
    frameStyle: frame ? frame.getAttribute('style') : null,
    box: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
    img: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), natural: img.naturalWidth + 'x' + img.naturalHeight, fit: getComputedStyle(img).objectFit } : null,
    frameCss: frame ? {
      overflow: getComputedStyle(frame).overflow,
      display: getComputedStyle(frame).display,
      aspect: getComputedStyle(frame).aspectRatio,
      maxH: getComputedStyle(frame).maxHeight,
    } : null,
    layers: layers,
  });
})()
