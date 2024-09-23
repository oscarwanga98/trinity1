const h3 = require("h3-js");

const latitude = 40.712776;
const longitude = -74.005974;
const h3Index = h3.latLngToCell(latitude, longitude, 9);
console.log(h3Index);
