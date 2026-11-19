import {createAircraft} from '../src/rendering/aircraft.js';
import {BASE_DESIGN, simulateFlight} from '../src/domain/flight.js';
import {modelHull} from '../src/rendering/collision-hull.js';
import {pullupLog} from '../src/domain/pullup-data.js';
import {pullupSeries, recoveryEvents, recoveryErrors, onsetDistances, returnTimes} from './pullup-analysis.js';

const hull=modelHull(createAircraft(BASE_DESIGN.span,BASE_DESIGN.incidence));
const measured=recoveryEvents(pullupLog);
function evaluate(options) {
  const run=simulateFlight(BASE_DESIGN,hull,options);
  const series=pullupSeries(run);
  return {...recoveryEvents(series),...recoveryErrors(series),distance:run.distance};
}
const winds=[true,false];
const references=winds.map(wind=>evaluate({wind}));
const shapeCount=[0,0], accepted=[0,0];
let both=0;
const examples=[];
for (const onsetMetres of onsetDistances) for (const returnSeconds of returnTimes) {
  const passes=winds.map((wind,i)=>{
    const result=evaluate({wind,onsetMetres,returnSeconds});
    const reference=references[i];
    const closer=key=>Math.abs(result[key]-measured[key])<Math.abs(reference[key]-measured[key]);
    const shape=closer('duration') && closer('gain');
    if(shape) shapeCount[i]++;
    const pass=shape && result.speed<=reference.speed && result.pitch<=reference.pitch;
    if(pass) accepted[i]++;
    if((returnSeconds===0.45 && [0,5,10].includes(onsetMetres)) ||
       (onsetMetres===0 && [0.25,0.8].includes(returnSeconds))) {
      examples.push({windMetres:wind?40:100,onsetMetres,returnSeconds,...result});
    }
    return pass;
  });
  if(passes.every(Boolean)) both++;
}
console.table(examples.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='number'?+v.toFixed(3):v]))));
console.log({measured, pairs:onsetDistances.length*returnTimes.length,shapeCount,accepted,both});
