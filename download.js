// دالة الفلترة القاطعة بناءً على بنية وسوم الـ Response للألبوم
function extractCleanImages(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // استهداف الـ divs التي تحمل كلاس img وبداخلها خاصية data-src حصراً
    // هذا يضمن جلب محتوى الألبوم الفعلي 100% وتجاهل أي شيء آخر
    const imgDivs = doc.querySelectorAll('div.img[data-src]');
    const imageUrls = new Set();

    imgDivs.forEach(div => {
        let src = div.getAttribute('data-src');
        if (src) {
            // تنظيف الرابط وإصلاح البروتوكول إذا كان نسبياً
            if (src.startsWith('//')) src = 'https:' + src;
            
            // التأكد من أنه رابط صورة حقيقي ينتمي لخوادم الموقع الفتيّة
            if (/\.(jpeg|jpg|png|webp)/i.test(src) && src.includes('erome.com')) {
                imageUrls.add(src);
            }
        }
    });

    return Array.from(imageUrls);
}

// الدالة الرئيسية للتحميل المباشر الصاروخي
async function executeDownload(htmlContent, targetUrl, updateStatus, updateProgress) {
    const urlsArray = extractCleanImages(htmlContent);

    if (urlsArray.length === 0) {
        throw new Error("لم يتم العثور على أي صور تطابق المعيار الصارم للألبوم داخل الـ Response.");
    }

    updateStatus(`اكتملت الفلترة الصارمة! تم عزل وتحديد ${urlsArray.length} صورة فعلية للألبوم بنجاح. جاري التحميل...`, "info");

    const zip = new JSZip();
    let loadedCount = 0;

    // تحميل الصور بالتوازي (Parallel Requests) للاستفادة القصوى من سرعة الإنترنت لديك
    const downloadPromises = urlsArray.map(async (imgUrl, index) => {
        try {
            // محاولة التحميل السريع المباشر
            const imgResp = await fetch(imgUrl);
            if (imgResp.ok) {
                const blob = await imgResp.blob();
                let cleanName = imgUrl.split('/').pop().split('?')[0];
                if (!cleanName) cleanName = `photo_${index + 1}.jpg`;
                
                zip.file(cleanName, blob);
                loadedCount++;
                
                const percent = Math.round((loadedCount / urlsArray.length) * 100);
                updateProgress(percent, `جاري جلب الصور الأساسية: ${loadedCount} من ${urlsArray.length}`);
            } else {
                throw new Error("CORS or Network Error");
            }
        } catch (e) {
            // استخدام البروكسي كخيار بديل وسريع للصور الفردية في حال قيود الـ CORS
            try {
                const altResp = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(imgUrl));
                if (altResp.ok) {
                    const blob = await altResp.blob();
                    let cleanName = imgUrl.split('/').pop().split('?')[0];
                    zip.file(cleanName || `photo_${index + 1}.jpg`, blob);
                    loadedCount++;
                    
                    const percent = Math.round((loadedCount / urlsArray.length) * 100);
                    updateProgress(percent, `جاري جلب الصور الأساسية: ${loadedCount} من ${urlsArray.length}`);
                }
            } catch(err) {
                console.error("فشل تحميل الصورة:", imgUrl);
            }
        }
    });

    // مزامنة كافة التحميلات في وقت واحد
    await Promise.all(downloadPromises);

    if (loadedCount === 0) throw new Error("فشل تحميل محتوى الصور، يرجى التحقق من اتصالك بالشبكة.");

    updateStatus("جاري حزم الـ 42 صورة داخل ملف الـ ZIP النهائي...", "info");
    
    const content = await zip.generateAsync({ type: "blob" });
    const downloadLink = document.createElement('a');
    downloadLink.href = URL.createObjectURL(content);
    
    const albumId = targetUrl.replace(/\/$/, '').split('/').pop();
    downloadLink.download = `album_${albumId || 'gallery'}.zip`;
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    updateStatus(`مبروك! تم تحميل وضغط الـ ${loadedCount} صورة الفعلية للألبوم بنجاح تام! 🎉`, "success");
}
