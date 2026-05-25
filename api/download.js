const axios = require("axios");
const cheerio = require("cheerio");
const archiver = require("archiver");

module.exports = async (req, res) => {

try{

const album = req.query.url;

if(!album){
return res.status(400).send("No URL");
}

const html = await axios.get(album,{
headers:{
"user-agent":"Mozilla/5.0"
}
});

const $ = cheerio.load(html.data);

let images = [];

$("img").each((i,el)=>{

const src = $(el).attr("src");

if(
src &&
(
src.includes(".jpg") ||
src.includes(".jpeg") ||
src.includes(".png")
)
){
images.push(src);
}

});

images = [...new Set(images)];

res.setHeader(
"Content-Type",
"application/zip"
);

res.setHeader(
"Content-Disposition",
'attachment; filename="erome_images.zip"'
);

const archive = archiver("zip");

archive.pipe(res);

for(let i=0;i<images.length;i++){

try{

const img = await axios.get(images[i],{
responseType:"arraybuffer",
headers:{
referer:"https://www.erome.com/"
}
});

archive.append(
img.data,
{ name:`image_${i}.jpg` }
);

}catch(e){}

}

await archive.finalize();

}catch(err){

res.status(500).send(err.message);

}

};
