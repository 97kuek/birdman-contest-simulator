export const atmosphere = `
uniform float clockTime;
uniform float meanWind;
uniform float gust;
uniform float windAngle;
vec2 windDirection(vec2 d){float c=cos(windAngle), s=sin(windAngle);return vec2(c*d.x-s*d.y,s*d.x+c*d.y);}
uniform vec3 sunlight;
float hash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float noiseField(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
vec3 skyColor(vec3 ray) {
  float h=max(ray.y,0.);
  float sunDot=max(dot(ray,sunlight),0.);
  vec3 color=mix(vec3(.65,.77,.81),vec3(.15,.37,.65),pow(h,.45));
  vec2 p=ray.xz/max(.08,h+.055)*1.35-windDirection(vec2(.906,.423))*clockTime*(.0006+meanWind*.0007);
  float cloud=.55*noiseField(p)+.28*noiseField(p*2.04+14.)+.12*noiseField(p*4.2)+.05*noiseField(p*9.1);
  float cover=smoothstep(.50,.70,cloud)*smoothstep(.008,.15,h);
  color=mix(color,mix(vec3(.74,.79,.80),vec3(.98,.95,.86),cloud),cover*.86);
  return color+vec3(.46,.36,.18)*pow(sunDot,28.)+vec3(.9,.77,.48)*smoothstep(.9996,.99994,sunDot);
}
`;

export const waterField = `
uniform sampler2D shallowMask;
uniform vec4 shoreBounds;
uniform float shoreReady;
uniform vec3 impact; // contact x, z and elapsed seconds
uniform vec2 impactDirection;
uniform float impactPower;
vec2 shoreUV(vec2 p){return vec2((p.x-shoreBounds.x)/(shoreBounds.z-shoreBounds.x),
                                  (shoreBounds.w-p.y)/(shoreBounds.w-shoreBounds.y));}
float shallowness(vec2 uv){
  if(shoreReady<.5 || any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) return 0.;
  return texture2D(shallowMask,uv).g;
}
// A finite directional spectrum. Height, d(height)/dx, d(height)/dz share wave phases.
// Frequencies follow the gravity–capillary deep-water dispersion relation in SI units.
vec3 band(vec2 p,vec2 dir,float wavelength,float amplitude,float phase,float footprint){
  float k=6.2831853/wavelength;
  float omega=sqrt(9.80665*k+.000073*k*k*k);
  float angle=k*dot(p,dir)-omega*clockTime+phase;
  float filtered=1.-smoothstep(.16,.55,footprint/wavelength);
  // A second oblique mode spreads each band into short, intersecting crests.
  float spread=.36+.13*sin(phase+1.);
  vec2 oblique=vec2(dir.x*cos(spread)-dir.y*sin(spread),dir.x*sin(spread)+dir.y*cos(spread));
  float k2=k*1.17, omega2=sqrt(9.80665*k2+.000073*k2*k2*k2);
  float secondary=k2*dot(p,oblique)-omega2*clockTime+phase*2.34+1.2;
  return filtered*amplitude*(.63*vec3(sin(angle),dir*(k*cos(angle)))+
                             .37*vec3(sin(secondary),oblique*(k2*cos(secondary))));
}
vec3 waves(vec2 p,float shore,float footprint){
  vec3 landing=vec3(0.);
  float age=impact.z;
  if(age>0. && age<7.){
    vec2 delta=p-impact.xy;
    float r=length(delta), ring=r-1.35*age;
    float envelope=exp(-ring*ring/.62-age*.52);
    float pulse=.035*sin(ring*7.)*envelope;
    float slope=.035*envelope*(7.*cos(ring*7.)-2.*ring/.62*sin(ring*7.));
    landing=vec3(pulse,slope*delta/max(r,.02))*smoothstep(0.,.12,age)
           *(1.-smoothstep(5.,7.,age))*(1.-smoothstep(.12,.35,footprint));
  }
  vec2 drift=p*.016-windDirection(vec2(.906,.423))*clockTime*.022;
  float waveGroup=.76+.48*noiseField(drift);
  float windScale=.13+.64*meanWind+.28*gust;
  float offshore=1.-.72*shore;
  vec3 surface=band(p,windDirection(vec2(.921,.390)),9.7,.027,0.,footprint)
              +band(p,windDirection(vec2(.725,.689)),4.1,.021,2.,footprint)
              +band(p,windDirection(vec2(.984,.178)),1.82,.014,4.,footprint);
  surface*=offshore;
  surface+=band(p,windDirection(vec2(.852,.524)),.78,.009,1.,footprint)
          +band(p,windDirection(vec2(.558,.830)),.34,.004,3.,footprint)
          +band(p,windDirection(vec2(.996,-.091)),.151,.002,5.,footprint);
  return surface*windScale*waveGroup+landing;
}
`;
