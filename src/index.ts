import puppeteer from "puppeteer-core";
import { Parser } from 'm3u8-parser';
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { exec } from "child_process";


type TArticleInfo = {
  url:string,
  date:string,
  normal:{
    title:string,
    body:string[],
  },
  furigana:{
    title:string,
    body:string[],
  }
}

/**
 * 根据当前日期及指定偏移天数，返回偏移的日期
 * @param dayOffset 距离当前日期的偏移值
 * @returns 指定偏移天数的日期
 */
function getDate(dayOffset: number = 1) {
  const currentDate = new Date()
  const yesterdayMilliseconds = currentDate.getMilliseconds() - 86400000 * dayOffset
  currentDate.setMilliseconds(yesterdayMilliseconds)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1
  const day = currentDate.getDate()

  return '' + year + (month < 10 ? '0' + month : month) + (day < 10 ? '0' + day : day)
}

/**
 * 根据文章信息生成markdown文件
 * @param articleInfo 文章信息
 */
function genMarkdownFile(articleInfo:TArticleInfo){
  const year = articleInfo.date.substring(0,3)
  const month = articleInfo.date.substring(4,5)
  const day = articleInfo.date.substring(6,7)

  let markdownFileText = `# [${articleInfo.furigana.title}](${articleInfo.url})
<audio controls src="${articleInfo.date+articleInfo.normal.title}.mp3"></audio>
<time datetime="${year}-${month}-${day}"><small>${year}年${month}月${day}日<br>
  <label>隐藏注音</label>
  <input type="checkbox" checked class="ruby-area">
</small></time>

`
  for(let i=0;i<articleInfo.furigana.body.length;i++){
    markdownFileText += articleInfo.furigana.body[i] + '\n\n'
  }

  const fileName = path.join(process.cwd(),`download/${articleInfo.date+articleInfo.normal.title}.md`)
  fs.writeFileSync(fileName,markdownFileText,{encoding:"utf-8"})

  console.log(`生成markdown文件成功，文件名称为${articleInfo.date+articleInfo.normal.title}.md`)
}

/**
 * 将aac文件转换为mp3文件，用于vscode的markdown预览
 * @param articleInfo 文章信息
 */
function transMediaToMP3(articleInfo: TArticleInfo) {
  const fileName = articleInfo.date + articleInfo.normal.title
  exec(
    `ffmpeg.exe -i "./download/${fileName}.aac" "./download/${fileName}.mp3"`,
    (error, stdout, stderr
    ) => {
      if (error) {
        console.error(`转换失败: ${fileName}.aac`);
        return;
      }
      if (stderr) {
        console.error(`转换失败: ${fileName}.aac`);
        return;
      }
      console.log(`媒体文件转换成功`);
    });
}


(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false,
    userDataDir: './userData',
    devtools: true
  });

  const page = await browser.newPage();
  await page.goto('https://news.web.nhk/news/easy/');
  await page.waitForSelector('article.news-list__item');
  const news_list_itemURL= await page.evaluate((currentDate)=>{
    const url =  Array.from(document.querySelectorAll('article.news-list__item>a'))
      .map(ele=>{
        const href = (ele as HTMLLinkElement).href
        return href
      })
    
    for(let i=url.length-1;i>=0;i--){
      if(!url[i]?.includes(currentDate)){
        url.pop()
      }else{
        break
      }
    }

    return url
  },getDate())

  let news_list_index = 0

  if(news_list_itemURL.length === 0){
    console.log('没有指定日期内的新闻')
  }

  /**
   * 传入文章网址列表及指定索引
   * @param news_list_itemURL 文章网址列表
   * @param index 处理当前文档的索引
   */
  async function gotoPage(news_list_itemURL: string[], index: number) {
    console.log(`开始第${index + 1}篇文章抓取，网址为${news_list_itemURL[index]}`)

    await page.goto(news_list_itemURL[index]!, { waitUntil: "networkidle2" })
    await page.waitForSelector('.js-open-audio')
    await page.click('.js-open-audio')
  }

  page.on('request',async req => { 
    const requestURL = req.url()
    const requestHeader = req.headers()
    if(!requestURL.includes('index_64k.m3u8') ){
      return
    }

    fetch(requestURL,{
      method:"GET",
      headers: requestHeader,
    }).then(response=>{
      return response.text()
    }).then(async result=> {
      // 将m3u8文件解析为js对象，方便操作
      const parser = new Parser();
      parser.push(result)
      parser.end()

      // 获取文章信息 TArticleInfo
      const articleInfo = await page.evaluate(()=>{
        /**
        * 传入标题元素根据是否注音生成不同的标题文本
        * @param furigana 是否添加注音
        * @param titleEle 文章标题元素
        * @returns 文章标题
        */
        function getTitle(furigana: boolean, titleEle: Node) {
          const treeWalker = document.createTreeWalker(titleEle, NodeFilter.SHOW_ALL, (node) => {
            if (node.nodeName === 'RT' && furigana === false) {
              return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
          })

          let title = '',node
          while ((node = treeWalker.nextNode())) {
            console.dir(node)
            console.log(node)
            if (node.nodeType === node.TEXT_NODE) {
              if(node.parentNode?.nodeName === 'RT' && node.nextSibling === null){
                title += node.nodeValue + '</rt>'

                if(node.parentNode?.nextSibling === null)
                  title += '</ruby>'
              } else if(node.parentNode?.nodeName === 'RUBY' && node.nextSibling === null){
                title += node.nodeValue + (furigana?'</ruby>':'')
              } else{
                title += node.nodeValue
              }
            } else if (node.nodeName === 'RUBY' || node.nodeName==='RT') {
              title += node.nodeName === 'RT'
                ? (furigana ? "<rt>" : "")
                : (furigana ? "<ruby>" : "")
            } else if (node.nodeName === "BR"){
              title += "\n\n"
            }
          }

          return title.trim()
        }

        /**
         * 根据文档的日期元素返回文档的发布日期文本，如 2026年2月16日 ⇒ 20260216
         * @param postDateEle 文章日期元素
         * @returns 文档发布日期
         */
        function getPostDate(postDateEle:Element){
          const postDateText = postDateEle.textContent
          const year = postDateText.matchAll(/(\d+)年/g).next().value
          const month =  postDateText.matchAll(/(\d+)月/g).next().value
          const day =  postDateText.matchAll(/(\d+)日/g).next().value

          let postDate=''
          if(year && month && day) {
            // @ts-ignore
            postDate = year[1] + (month[1].length===2?month[1]:'0'+month[1])+ (day[1].length===2?day[1]:'0'+day[1])
          }
          return postDate
        }

        const titleEle = document.querySelector('.easy-article>.article-title')
        const dateEle = document.querySelector('.easy-article>#js-article-date')
        const bodyEle = document.querySelector('.easy-article>#js-article-body')

        let bodyTextNormal = [],bodyTextFurigana=[],pEles
        if(bodyEle?.hasChildNodes()&&(pEles = bodyEle.children)){
          for(const pEle of pEles){
            bodyTextNormal.push(getTitle(false,pEle))
            bodyTextFurigana.push(getTitle(true,pEle))
          }
        }
        return {
          url: window.location.href,
          date: dateEle?getPostDate(dateEle):'',
          normal:{
            title: titleEle?getTitle(false,titleEle):'',
            body: bodyEle?bodyTextNormal:[]
          },
          furigana:{
            title:titleEle?getTitle(true,titleEle):'',
            body: bodyEle?bodyTextFurigana:[]
          }
        }
      })

      // 生成文章markdown文件
      genMarkdownFile(articleInfo)
      // 写入m3u8数据
      fs.writeFileSync(path.join(process.cwd(),'download',articleInfo.date+articleInfo.normal.title+'.m3u8'),result,{encoding:"utf-8"})
      const mediaName = `./download/${articleInfo.date+articleInfo.normal.title}.aac`
      const writeStream = fs.createWriteStream(mediaName); 
      for (const [segmentIndex,segment] of parser.manifest.segments.entries()) {
        if(!segment.key) return;

        const mediaURL = new URL(requestURL)
        const mediaURI = mediaURL.origin + mediaURL.pathname.replace('index_64k.m3u8','') + segment.uri
        const keyURI = segment.key.uri

        // 获取加密数据
        let encryptedMediaContent = await fetch(mediaURI,{
          method: "GET",
          headers: requestHeader
        }).then(response=>response.arrayBuffer())
        // 获取加密密钥
        let keyContent = await fetch(keyURI,{
          method: "GET",
          headers: requestHeader
        }).then(response=>response.arrayBuffer())

        //开始解密
        if (!keyContent) return;
        let keyView = new DataView(keyContent);
        let mediaView = new DataView(encryptedMediaContent)
        const iv = Buffer.alloc(16)
        iv.writeUInt32BE(segmentIndex,12)
        const decipher = crypto.createDecipheriv("aes-128-cbc",keyView,iv)

        writeStream.write(Buffer.concat([decipher.update(mediaView),decipher.final()])); 
      } 
      writeStream.end(()=>{
        // 将aac文件转换为mp3文件，用于vscode内置markdown的音频
        transMediaToMP3(articleInfo)
        // // 下载列表剩余 文章
        news_list_index < news_list_itemURL.length && gotoPage(news_list_itemURL, news_list_index++)
      });
    })
  });

  // 清空下载目录
  fs.rmSync(path.join(process.cwd(),'download'),{recursive:true,force:true})
  fs.mkdirSync(path.join(process.cwd(),'download'),{recursive:true})

  // 开始下载
  gotoPage(news_list_itemURL,news_list_index++)
})();

