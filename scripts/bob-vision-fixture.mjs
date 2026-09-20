// Synthetic visual-only oracle. Never use an actual user's photo for release proof.
import { deflateSync } from 'node:zlib'
export function visionFixture() {
  const width=240, height=180, raw=Buffer.alloc((width*3+1)*height,255)
  for(let y=0;y<height;y++){
    raw[y*(width*3+1)]=0
    for(let x=0;x<width;x++){
      let rgb=[255,255,255]
      if(x>=20&&x<95&&y>=20&&y<90)rgb=[220,15,15]
      if(x>=145&&x<220&&y>=20&&y<90)rgb=[15,30,230]
      if((x-120)**2+(y-137)**2<=24**2)rgb=[20,175,40]
      for(let c=0;c<3;c++)raw[y*(width*3+1)+1+x*3+c]=rgb[c]
    }
  }
  const crc=b=>{let v=0xffffffff;for(const n of b){v^=n;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0)}return (v^0xffffffff)>>>0}
  const chunk=(name,data)=>{const tag=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([len,tag,data,sum])}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2
  return {width,height,bytes:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
}
