import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { addRigidAssembly, box, ellipsoid, mesh, rod, shaded, surfacePatch } from './aircraft/mesh-parts.js';
import { lettering } from './aircraft/lettering.js';
import { createCrewHead } from './crew-model.js';

function vanBody(shell, rounded, paint, trim) {
  rounded([0,.76,0], [1.40,.88,4.54], .09, paint, '車体中央');
  rounded([0,1.175,0], [1.65,.070,4.46], .032, paint, 'ウエストライン');
  rounded([0,.78,-2.08], [1.67,.85,.42], .086, paint, 'ノーズ');
  rounded([0,.77,2.09], [1.67,.86,.41], .084, paint, 'リアコーナー');
  box(shell,[0,.43,0],[1.37,.14,4.50],trim,'床下');

  const edge=[[-2.20,.32]];
  for (const axle of [-1.285,1.285]) {
    for (let i=0; i<=20; i++) {
      const a=Math.PI-i*Math.PI/20;
      edge.push([axle+.365*Math.cos(a),.325+.365*Math.sin(a)]);
    }
  }
  edge.push([2.20,.32]);
  for (const side of [-1,1]) {
    surfacePatch(shell,'フェンダーとサイドパネル',edge.length-1,4,(u,v)=>{
      const [z,lower]=edge[Math.round(u*(edge.length-1))];
      return [side*(.830+.009*Math.sin(Math.PI*v)), lower+(1.197-lower)*v, z];
    },paint);
    for (const axle of [-1.285,1.285]) {
      const well=mesh(shell,new THREE.CylinderGeometry(.36,.36,.125,32).rotateZ(Math.PI/2),trim,'ホイールハウス');
      well.position.set(side*.742,.325,axle);
      const lip=[];
      for (let i=0; i<=18; i++) {
        const a=Math.PI-i*Math.PI/18;
        lip.push(new THREE.Vector3(side*.831,.325+.366*Math.sin(a),axle+.366*Math.cos(a)));
      }
      mesh(shell,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lip),24,.009,6,false),paint,'フェンダー折り返し');
    }
    rounded([side*.755,1.49,2.205],[.151,.712,.140],.046,paint,'リアピラー');
    rounded([side*.829,.385,0],[.025,.052,1.76],.010,paint,'サイドシル');
  }
  // The high roof continues upward from the gutter; the crown rounds into
  // the header of the windshield and into the top of the rear door.
  const roof=[
    [-1.942,.765,1.857,1.887],[-1.87,.781,1.865,2.018],[-1.70,.798,1.867,2.162],
    [-1.46,.803,1.867,2.235],[-1.20,.804,1.867,2.240],[1.82,.804,1.867,2.240],
    [2.01,.799,1.867,2.211],[2.15,.786,1.851,2.135],[2.234,.762,1.844,2.010],
    [2.264,.742,1.837,1.864],
  ];
  surfacePatch(shell,'ハイルーフ外板',42,roof.length-1,(u,v)=>{
    const [z,w,eave,crown]=roof[Math.round(v*(roof.length-1))], a=u*Math.PI;
    return [-w*Math.cos(a),eave+(crown-eave)*Math.sin(a)**.48,z];
  },paint);
  for (const side of [-1,1])
    rod(shell,[side*.79,1.862,-1.88],[side*.80,1.862,2.20],.014,paint,'雨樋');
  for (const x of [-.48,-.24,0,.24,.48]) {
    const rise=.373*(1-(x/.804)**2)**.24;
    rounded([x,1.867+rise,.22],[.024,.012,2.92],.005,paint,'ルーフリブ');
  }
}

function dashboardGrain() {
  // Fine molded vinyl stipple. One tile covers about 12 cm of the dashboard.
  const size = 128, pixels = new Uint8Array(size * size * 4);
  let seed = 72;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const shade = 184 + (seed >>> 26);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = shade;
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 5);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function addFrontCabin(group, shell, rounded, trim) {
  const pad = shaded('#515658', { roughness: .89 }), fascia = shaded('#343839', { roughness: .79 });
  const recess = shaded('#141819'), blade = shaded('#464b4d'), lining = shaded('#777875');
  const lens = shaded('#617071', { roughness: .36 }), bright = shaded('#a0a8a6');
  const width = .804;
  const crossSection = [
    [-2.246,1.219],[-2.211,1.260],[-2.146,1.292],[-2.065,1.320],
    [-1.985,1.344],[-1.912,1.361],[-1.855,1.366],[-1.813,1.357],
    [-1.783,1.337],[-1.772,1.309],[-1.771,1.205],[-1.782,1.125],
  ];
  // Molded pad rises from the glass, rolls down over the fascia and curves
  // back toward the seats at either door. Its upper edge defines the view.
  const grain = dashboardGrain();
  const vinyl = shaded('#73797b', { vertexColors: true, map: grain, bumpMap: grain, bumpScale: .0006, roughness: .84 });
  const dash = surfacePatch(group,'インストルメントパネル上面',40,crossSection.length-1,(u,v)=>{
    const x = (u*2-1)*width, edge = (x/width)**2;
    const [z,y] = crossSection[Math.round(v*(crossSection.length-1))];
    return [x,y-.025*edge,z+.063*edge];
  },vinyl,true);
  const colours = [];
  const uv = dash.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const edge = Math.abs(uv.getX(i) * 2 - 1);
    const exposure = (.98 - .58 * THREE.MathUtils.smoothstep(uv.getY(i), .18, .97)) * (1 - .1 * edge);
    colours.push(exposure, exposure, exposure);
  }
  dash.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
  for (const side of [-1,1]) {
    // Rubber seal inside the painted metal, and the separate pillar trim.
    rod(shell,[side*.748,1.222,-2.208],[side*.711,1.85,-1.918],.017,recess,'ガラスモール');
    rod(shell,[side*.780,1.234,-2.185],[side*.734,1.849,-1.872],.047,lining,'Aピラートリム');
    rounded([side*.39,1.881,-1.769],[.54,.037,.158],.017,lining,'収納位置のサンバイザー');
    for (let i=0;i<10;i++) {
      const x=side*(.14+i*.050), edge=(x/width)**2;
      const vent=box(shell,[x,1.297-.025*edge,-2.134+.063*edge],[.036,.004,.022],recess,'デフロスター吹出口');
      vent.rotation.x=-.32;
    }
  }
  surfacePatch(shell,'天井前端の布張り',18,6,(u,v)=>{
    const x=(u*2-1)*.782;
    return [x,1.867+.093*v-.016*(x/.782)**2,-1.922+.47*v];
  },shaded('#595b56',{roughness:.98}));
  rod(shell,[-.72,1.866,-1.916],[.72,1.866,-1.916],.019,recess,'ガラス上縁');
  rod(shell,[-.764,1.219,-2.229],[.764,1.219,-2.229],.012,recess,'ガラス下縁');
  // Parked wipers have a pivot, a bent spring arm, a blade carrier and a
  // narrow rubber edge. They rest outside the lower strip of the windshield.
  for (const [pivot, elbow, end] of [[-.61,-.43,-.17],[.13,.26,.47]]) {
    const pivotY=1.236;
    ellipsoid(shell,[pivot,pivotY,-2.252],[.026,.018,.018],recess,'ワイパーピボット');
    rod(shell,[pivot,pivotY,-2.256],[elbow,1.293,-2.205],.006,trim,'ワイパーアーム');
    rod(shell,[elbow,1.293,-2.205],[end,1.313,-2.184],.0055,trim,'ワイパーアーム');
    ellipsoid(shell,[end,1.318,-2.182],[.021,.010,.007],trim,'ワイパージョイント');
    for (const direction of [-1,1]) {
      const clampX=end+direction*.123, clampY=1.309+direction*.004;
      rod(shell,[end,1.318,-2.182],[clampX,clampY,-2.190],.0032,blade,'ブレードブリッジ');
      rod(shell,[clampX,clampY,-2.190],[clampX+direction*.045,clampY-.012,-2.199],.0027,trim,'ブレード押さえ');
    }
    const rubber=box(shell,[end,1.303,-2.198],[.43,.005,.009],recess,'ワイパーゴム');
    rubber.rotation.z=.033;
  }

  const ventZ=-1.749;
  for (const [x,w] of [[-.628,.145],[-.203,.083],[.123,.083],[.667,.11]]) {
    const offset=.058*(x/width)**2, y=1.305-.025*(x/width)**2;
    rounded([x,y,ventZ+offset],[w+.019,.077,.021],.009,fascia,'ベント枠');
    box(shell,[x,y,ventZ+.012+offset],[w,.058,.006],recess,'ベント開口');
    for(let i=-2;i<=2;i++)
      box(shell,[x,y+i*.011,ventZ+.017+offset],[w-.005,.0035,.009],blade,'ベントルーバー').rotation.x=-.22;
    box(shell,[x+.01,y,ventZ+.024+offset],[.023,.006,.007],bright,'風向調整つまみ');
  }
  rounded([-.039,1.285,-1.747],[.248,.116,.031],.014,fascia,'センタークラスター');
  rounded([-.039,1.285,-1.727],[.207,.085,.010],.004,recess,'オーディオ枠');
  box(shell,[-.039,1.288,-1.719],[.179,.058,.006],lens,'オーディオ表示窓');
  for(const x of [-.148,.069]) {
    const knob=mesh(shell,new THREE.CylinderGeometry(.012,.012,.012,12),blade,'オーディオノブ');
    knob.rotation.x=Math.PI/2; knob.position.set(x,1.255,-1.717);
  }

  // The driver's binnacle is a hood above a recessed dial face, not a
  // rectangular block. Only part of the cluster shows from the passenger.
  const centre=.372, bottom=1.254;
  surfacePatch(shell,'メーターフード',26,5,(u,v)=>{
    const angle=u*Math.PI, z=-1.985+v*.259;
    return [centre+(.232-.012*(1-v))*Math.cos(angle),
      bottom+(.132+.038*Math.sin(v*Math.PI*.82))*Math.sin(angle),z];
  },pad);
  const hood = [];
  for(let i=0;i<=24;i++){
    const a=i*Math.PI/24;
    hood.push(new THREE.Vector3(centre+.232*Math.cos(a),bottom+.152*Math.sin(a),-1.726));
  }
  mesh(shell,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hood),26,.009,6,false),fascia,'メーターフード縁');
  rounded([centre,1.293,-1.76],[.422,.154,.032],.015,recess,'メーターケース');

  const needles=[];
  for(const [x, radius, maximum] of [[.28,.063,6],[.463,.076,180]]) {
    const y=1.317, z=-1.735;
    const rim=mesh(shell,new THREE.TorusGeometry(radius,.003,6,42),blade,'メーターリング');
    rim.position.set(x,y,z);
    const intervals=maximum===6?24:36;
    for(let i=0;i<=intervals;i++) {
      const a=THREE.MathUtils.degToRad(-135+270*i/intervals);
      const major=i%(maximum===6?4:6)===0;
      const r=radius*(major?.82:.90);
      rod(shell,[x+r*Math.sin(a),y+r*Math.cos(a),z],[x+radius*.95*Math.sin(a),y+radius*.95*Math.cos(a),z],
        major?.0014:.0008,bright,'メーター目盛');
    }
    const pivot=new THREE.Group();
    pivot.position.set(x,y,z+.004);
    const pointer=box(pivot,[0,radius*.35,0],[.0025,radius*.73,.0025],shaded('#c5654d'),'指針');
    pointer.castShadow=false;
    group.add(pivot);
    needles.push(pivot);
  }

  // Central mirror housing and glass are separate so its dark underside
  // remains visible at the upper edge, as in the chase-car recording.
  rounded([0,1.848,-1.947],[.053,.039,.040],.01,recess,'ミラー台座');
  rod(shell,[0,1.851,-1.94],[.015,1.826,-1.887],.014,trim,'ミラーステー');
  const housing=rounded([.015,1.814,-1.867],[.258,.080,.035],.016,fascia,'ルームミラーケース');
  // Bisect the rays to the passenger's eye and the centre of the rear window.
  const toEye = group.getObjectByName('chase-car-camera').position.clone().sub(housing.position).normalize();
  const toRear = new THREE.Vector3(0,1.52,2.32).sub(housing.position).normalize();
  housing.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), toEye.add(toRear).normalize());
  const outline=new THREE.Shape();
  const w=.117, h=.030, r=.008;
  outline.moveTo(-w+r,-h); outline.lineTo(w-r,-h); outline.quadraticCurveTo(w,-h,w,-h+r);
  outline.lineTo(w,h-r); outline.quadraticCurveTo(w,h,w-r,h);
  outline.lineTo(-w+r,h); outline.quadraticCurveTo(-w,h,-w,h-r);
  outline.lineTo(-w,-h+r); outline.quadraticCurveTo(-w,-h,-w+r,-h);
  const mirror=new Reflector(new THREE.ShapeGeometry(outline),{
    color:0xdfe5e4, textureWidth:384, textureHeight:192, multisample:0, clipBias:.002,
  });
  mirror.name='ルームミラー鏡面';
  mirror.quaternion.copy(housing.quaternion);
  mirror.position.set(0,0,.020).applyQuaternion(housing.quaternion).add(housing.position);
  group.add(mirror);
  const mirrorPosition=new THREE.Vector3();
  const reflect=mirror.onBeforeRender;
  let lastReflection=-Infinity;
  mirror.onBeforeRender=function(renderer,scene,camera) {
    const now=performance.now();
    if (now-lastReflection<40 || camera.position.distanceToSquared(this.getWorldPosition(mirrorPosition))>2.25) return;
    lastReflection=now;
    reflect.call(this,renderer,scene,camera);
  };
  box(shell,[.021,1.769,-1.855],[.043,.011,.018],trim,'ミラー防眩レバー');

  const wheel = mesh(shell,new THREE.TorusGeometry(.17,.019,8,36),fascia,'ステアリングリム');
  wheel.position.set(.40,1.302,-1.645); wheel.rotation.x=-.62;
  ellipsoid(shell,[.40,1.30,-1.64],[.078,.054,.037],fascia,'ステアリングパッド');
  for(const side of [-1,1])
    rod(shell,[.40+side*.14,1.315,-1.65],[.40+side*.04,1.29,-1.631],.012,fascia,'ステアリングスポーク');

  return speed => {
    const kmh=THREE.MathUtils.clamp(speed*3.6,0,180);
    needles[1].rotation.z=THREE.MathUtils.degToRad(135-270*kmh/180);
    needles[0].rotation.z=THREE.MathUtils.degToRad(135-270*Math.min(4.5,.8+speed*.11)/6);
  };
}

// Hiace Van, long / standard width / high roof: 4.695 × 1.695 × 2.24 m,
// 2.57 m wheelbase. Modelled from Toyota's January 2026 dimensional drawing.
export function createRunwaySupportCar() {
  const group = new THREE.Group();
  group.name = '追走車';
  const cameraMount = new THREE.Object3D();
  cameraMount.name = 'chase-car-camera';
  // The camera rides just ahead of the passenger, behind the dashboard.
  cameraMount.position.set(-.12, 1.545, -1.27);
  group.add(cameraMount);
  const shell = new THREE.Group();
  shell.name = 'ハイエース';
  const paint = shaded('#efece4'), trim = shaded('#2c3236'), chrome = shaded('#aebbc0', { metalness: .6 });
  const frontGlass = new THREE.MeshBasicMaterial({ color: '#739098', transparent: true, opacity: .26, depthWrite: false, side: THREE.DoubleSide });
  const glassEye=new THREE.Vector3();
  frontGlass.onBeforeRender=(renderer,scene,camera,geometry,object)=>{
    object.worldToLocal(camera.getWorldPosition(glassEye));
    const inCabin=Math.abs(glassEye.x)<.83 && glassEye.y>.9 && glassEye.y<2.22 && Math.abs(glassEye.z)<2.25;
    frontGlass.opacity=inCabin?.025:.26;
  };
  const rearGlass = shaded('#3c5158', { roughness: .25 }), lamp = shaded('#dbe6eb', { roughness: .29 }), stop = shaded('#b83230'), signal = shaded('#e3a544');
  function rounded(center, sizes, radius, material, name) {
    const source = new RoundedBoxGeometry(...sizes, 3, radius);
    const part = mesh(shell, mergeVertices(source), material, name);
    source.dispose();
    part.position.set(...center);
    return part;
  }
  function panel(points, material, name) {
    surfacePatch(shell, name, 1, 1, (u, v) => {
      const a = points[v ? 3 : 0], b = points[v ? 2 : 1];
      return a.map((value, axis) => value + (b[axis] - value) * u);
    }, material);
  }
  vanBody(shell, rounded, paint, trim);
  for (const side of [-1, 1]) {
    const x = side * .838;
    panel([[x, 1.18, -.74], [x, 1.18, 2.26], [side*.79, 1.91, 2.24], [side*.79, 1.91, -.74]], paint, '窓枠');
    // Expose the front cabin between the A- and B-pillars.
    const frontWindow = [[x + side*.007,1.20,-2.14],[x + side*.007,1.20,-.76],[side*.795,1.82,-.76],[side*.79,1.82,-1.91]];
    panel(frontWindow, frontGlass, '前席の側窓');
    for (let i=0;i<frontWindow.length;i++)
      rod(shell,frontWindow[i],frontWindow[(i+1)%frontWindow.length],.010,trim,'前席窓のゴムモール');
    for (const [z, length] of [[.04, 1.40], [1.51, 1.29]])
      box(shell, [x, 1.51, z], [.028, .62, length], rearGlass, '後部側窓');
    for (const z of [-.73, .81]) box(shell, [x, .83, z], [.012, .86, .013], trim, 'ドア見切り');
    box(shell, [x, 1.13, -.58], [.032, .05, .18], trim, 'スライドドアハンドル');
    box(shell, [x, 1.13, -.87], [.032, .05, .16], trim, '前席ハンドル');
    box(shell, [x, 1.07, 1.52], [.035, .022, 1.22], trim, 'スライドレール');
    rod(shell, [x,1.21,-1.92], [side*.98,1.27,-2.00], .026, trim, 'ミラーステー');
    box(shell, [side*.985,1.34,-2.00], [.13,.20,.13], paint, 'ドアミラー');
    rod(shell, [side*.77,1.18,-2.23],[side*.75,1.87,-1.91], .043, paint, 'Aピラー');
    if (side < 0) rod(shell, [x,.96,-2.18],[side*.88,1.13,-2.30], .02, trim, 'アンダーミラー');
    const headlamp=rounded([side*.599,.983,-2.286],[.416,.216,.066],.030,trim,'ヘッドランプケース');
    headlamp.rotation.y=side*.105;
    const cover=rounded([side*.599,.983,-2.316],[.401,.199,.035],.016,lamp,'ヘッドランプレンズ');
    cover.rotation.y=headlamp.rotation.y;
    for(const offset of [-.077,.065]) {
      const reflector=mesh(shell,new THREE.TorusGeometry(.049,.006,5,18),chrome,'ランプ反射鏡');
      reflector.position.set(side*(.599+offset),.992,-2.339+offset*.10);
      reflector.scale.x=1.13;
    }
    rounded([side*.777,.977,-2.297],[.046,.164,.045],.015,signal,'方向指示灯');
    rounded([side*.749,1.096,2.290],[.142,.47,.072],.035,trim,'リヤコンビネーションランプ');
    rounded([side*.749,1.091,2.325],[.129,.449,.032],.014,stop,'テールランプレンズ');
    box(shell,[side*.749,1.107,2.343],[.121,.073,.009],lamp,'後退灯');
    box(shell,[side*.749,1.178,2.343],[.121,.043,.009],signal,'後方ウインカー');
  }
  panel([[-.78,1.17,-2.24],[.78,1.17,-2.24],[.74,1.88,-1.92],[-.74,1.88,-1.92]], frontGlass, 'フロントガラス');
  box(shell, [0,.79,-2.29], [1.47,.16,.07], trim, 'メイングリル');
  for (const y of [.75,.81,.89]) box(shell, [0,y,-2.33],[1.30,.024,.026],chrome,'グリル横桟');
  rounded([0,.51,-2.30],[1.62,.25,.095],.042,paint,'前バンパー');
  box(shell, [0,.47,-2.35],[.91,.10,.02],trim,'ロアグリル');
  box(shell, [0,.52,-2.365],[.33,.165,.009],lamp,'前ナンバー');
  rounded([0,.79,2.278],[1.445,.84,.079],.039,paint,'バックドア下部');
  for (const side of [-1,1]) box(shell,[side*.707,1.52,2.278],[.065,.64,.075],paint,'バックドア縦枠');
  box(shell,[0,1.835,2.278],[1.45,.055,.078],paint,'バックドア上枠');
  const backWindow = new THREE.MeshBasicMaterial({color:'#96acaa',transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide});
  panel([[-.675,1.215,2.317],[.675,1.215,2.317],[.675,1.825,2.317],[-.675,1.825,2.317]],backWindow,'リアガラス');
  for (let i=0; i<7; i++) box(shell,[0,1.31+i*.061,2.338],[1.25,.003,.002],trim,'熱線');
  box(shell,[0,1.84,2.282],[.31,.032,.03],stop,'ハイマウントストップランプ');
  rod(shell, [-.22,1.29,2.343],[.30,1.32,2.343],.009,trim,'リアワイパー');
  rounded([0,.40,2.30],[1.65,.17,.096],.042,trim,'後バンパー');
  rounded([0,.77,2.32],[.42,.23,.024],.011,chrome,'ナンバー周囲');
  box(shell,[0,.77,2.335],[.33,.165,.009],lamp,'後ナンバー');
  box(shell,[0,.94,2.322],[.31,.055,.019],trim,'バックドアハンドル');
  for (const z of [-2.35,2.33]) {
    const y=z<0?.965:1.10;
    for (const [rx,ry,dy] of [[.074,.046,0],[.019,.039,0],[.054,.016,.014]]) {
      const oval=mesh(shell,new THREE.TorusGeometry(ry,.004,5,24),chrome,'楕円エンブレム');
      oval.scale.x=rx/ry; oval.position.set(0,y+dy,z);
    }
  }
  const indicateSpeed = addFrontCabin(group, shell, rounded, trim);
  for (const side of [-1,1]) {
    const x=side*.40;
    rounded([x,1.23,-1.10],[.43,.49,.18],.075,trim,'前席の背もたれ');
    rounded([x,1.53,-1.11],[.22,.16,.12],.055,trim,'ヘッドレスト');
    rounded([x,1.024,-1.35],[.41,.125,.43],.058,trim,'シートクッション');
    const shirt=shaded('#ac4439'), skin=shaded('#cb9777');
    ellipsoid(shell,[x,1.32,-1.33],[.186,.24,.126],shirt,'乗員の上体');
    for (const arm of [-1,1]) {
      const shoulder=[x+arm*.140,1.475,-1.32], elbow=[x+arm*.188,1.315,-1.409];
      const hand=side>0 ? [x+arm*.148,1.333,-1.672] : [x+arm*.098,1.132,-1.505];
      rod(shell,shoulder,elbow,.050,shirt,'半袖の腕');
      ellipsoid(shell,elbow,[.045,.046,.045],skin,'肘');
      rod(shell,elbow,hand,.036,skin,'前腕');
      ellipsoid(shell,hand,[.039,.034,.047],skin,side>0?'ハンドルを握る手':'膝に置いた手');
    }
    rod(shell,[x+side*.13,1.49,-1.40],[x-side*.13,1.16,-1.445],.014,trim,'シートベルト');
    const head = createCrewHead('#cb9777','#292827');
    head.position.set(x,1.66,-1.36);
    group.add(head);
  }
  addRigidAssembly(group, shell);
  const badge = mesh(group,new THREE.PlaneGeometry(.31,.087),lettering('HIACE'),'バックドアエンブレム');
  badge.position.set(-.50,.88,2.321);
  const wheels=[];
  const tire = new THREE.CylinderGeometry(.325,.325,.195,24).rotateZ(Math.PI/2);
  const hub = new THREE.CylinderGeometry(.205,.205,.202,20).rotateZ(Math.PI/2);
  for (const side of [-1,1]) for (const z of [-1.285,1.285]) {
    const wheel = new THREE.Group();
    wheel.position.set(side*.772,.325,z);
    mesh(wheel,tire,trim,'タイヤ'); mesh(wheel,hub,chrome,'ホイール');
    for (let i=0; i<6; i++) {
      const angle=i*Math.PI/3;
      ellipsoid(wheel,[side*.103,.137*Math.cos(angle),.137*Math.sin(angle)],[.009,.028,.028],trim,'ホイール穴');
    }
    group.add(wheel); wheels.push(wheel);
  }
  return { group, setDistance(metres, speed = 0) {
    for (const wheel of wheels) wheel.rotation.x = -metres / .325;
    indicateSpeed(speed);
  } };
}
