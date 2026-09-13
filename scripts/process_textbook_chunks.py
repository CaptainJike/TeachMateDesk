import os
import re
import json

CURRICULUM_V1 = [
    {"unit": "第一单元活动·探究", "lesson_no": "01", "title": "消息二则", "author": "毛泽东", "category": "新闻消息", "sub_titles": ["我三十万大军胜利南渡长江", "人民解放军百万大军横渡长江"], "keywords": ["毛泽东", "渡江战役", "消息二则", "电头", "导语", "主体", "摧枯拉朽", "锐不可当"]},
    {"unit": "第一单元活动·探究", "lesson_no": "02", "title": "中国人首次进入自己的空间站", "author": "余建斌、吴月辉、刘诗瑶", "category": "新闻通讯", "keywords": ["空间站", "神舟十二号", "航天员", "聂海胜", "刘伯明", "汤洪波", "天和核心舱"]},
    {"unit": "第一单元活动·探究", "lesson_no": "03", "title": "首届诺贝尔奖颁发", "author": "新华社", "category": "新闻消息", "keywords": ["诺贝尔奖", "诺贝尔", "物理学奖", "化学奖", "伦琴", "X射线", "和平奖"]},
    {"unit": "第一单元活动·探究", "lesson_no": "04", "title": "“飞天”凌空——跳水姑娘吕伟夺魁记", "author": "夏浩然、樊云芳", "category": "新闻特写", "keywords": ["飞天凌空", "吕伟", "跳水", "特写", "亚运会", "起跳", "腾空", "入水", "轻盈"]},
    {"unit": "第一单元活动·探究", "lesson_no": "05", "title": "一着惊海天——目击我国航母舰载战斗机首架次成功着舰", "author": "蔡年迟、蒲海洋", "category": "新闻特写", "keywords": ["航母舰载战斗机", "歼-15", "辽宁舰", "戴明盟", "着舰", "阻拦索", "惊海天"]},
    {"unit": "第一单元活动·探究", "lesson_no": "06", "title": "国行公祭，为佑世界和平", "author": "钟声", "category": "新闻评论", "keywords": ["国家公祭", "南京大屠杀", "和平", "新闻评论", "社论", "铭记历史"]},
    {"unit": "第二单元", "lesson_no": "07", "title": "藤野先生", "author": "鲁迅", "category": "散文/回忆录", "keywords": ["鲁迅", "藤野先生", "藤野严九郎", "仙台", "医学", "讲义", "弃医从文", "匿名信", "看电影事件"]},
    {"unit": "第二单元", "lesson_no": "08", "title": "回忆鲁迅先生（节选）", "author": "萧红", "category": "回忆性散文", "keywords": ["萧红", "鲁迅", "许广平", "海婴", "生活细节", "写作", "笑声", "朴素"]},
    {"unit": "第二单元", "lesson_no": "09", "title": "天上有颗“南仁东星”", "author": "王宏甲", "category": "人物传记", "keywords": ["南仁东", "中国天眼", "FAST", "射电望远镜", "射电天文", "大窝凼", "时代楷模"]},
    {"unit": "第二单元", "lesson_no": "10", "title": "美丽的颜色", "author": "艾芙·居里", "category": "人物传记", "keywords": ["居里夫妇", "居里夫人", "玛丽·居里", "皮埃尔·居里", "镭", "沥青铀矿", "美丽的颜色", "荧光"]},
    {"unit": "第二单元", "lesson_no": "导读", "title": "名著导读：《红星照耀中国》", "author": "埃德加·斯诺", "category": "名著导读", "keywords": ["红星照耀中国", "西行漫记", "埃德加·斯诺", "毛泽东", "周恩来", "朱德", "长征", "红军"]},
    {"unit": "第三单元", "lesson_no": "11", "title": "三峡", "author": "郦道元", "category": "文言文", "keywords": ["三峡", "郦道元", "水经注", "自三峡七百里中", "重岩叠嶂", "隐天蔽日", "夏水襄陵", "素湍绿潭", "林寒涧肃", "高猿长啸"]},
    {"unit": "第三单元", "lesson_no": "12", "title": "短文二篇（答谢中书书 / 记承天寺夜游）", "author": "陶弘景、苏轼", "category": "文言文", "keywords": ["陶弘景", "答谢中书书", "山川之美", "古来共谈", "高峰入云", "清流见底", "苏轼", "记承天寺夜游", "张怀民", "庭下如积水空明", "水中藻荇交横", "但少闲人如吾两人者耳"]},
    {"unit": "第三单元", "lesson_no": "13", "title": "与朱元思书", "author": "吴均", "category": "文言文", "keywords": ["吴均", "与朱元思书", "骈文", "风烟俱净", "天山共色", "从流飘荡", "水皆缥碧", "急湍甚箭", "鸢飞戾天者", "望峰息心"]},
    {"unit": "第三单元", "lesson_no": "14", "title": "唐诗五首", "author": "王绩、崔颢、王维、李白、白居易", "category": "古诗词", "keywords": ["野望", "王绩", "东皋薄暮望", "黄鹤楼", "崔颢", "昔人已乘黄鹤去", "日暮乡关何处是", "使至塞上", "王维", "大漠孤烟直", "长河落日圆", "渡荆门送别", "李白", "山随平野尽", "月下飞天镜", "钱塘湖春行", "白居易", "几处早莺争暖树", "乱花渐欲迷人眼"]},
    {"unit": "第三单元", "lesson_no": "古诗", "title": "课外古诗词诵读（上册第一辑）", "author": "曹操、刘桢、曹植等", "category": "古诗词诵读", "keywords": ["庭中有奇树", "古诗十九首", "龟虽寿", "曹操", "老骥伏枥", "志在千里", "烈士暮年", "壮心不已", "赠从弟", "刘桢", "岂不罹凝寒", "松柏有本性", "梁甫行", "曹植", "柴门何萧条"]},
    {"unit": "第四单元", "lesson_no": "15", "title": "背影", "author": "朱自清", "category": "散文", "keywords": ["朱自清", "背影", "父亲", "车站", "买橘子", "蹒跚", "紫毛大衣", "朱红的橘子", "泪水", "父爱"]},
    {"unit": "第四单元", "lesson_no": "16", "title": "白杨礼赞", "author": "茅盾", "category": "抒情散文", "keywords": ["茅盾", "白杨礼赞", "西北高原", "力争上游", "倔强挺立", "参天耸立", "不折不挠", "抗日军民", "象征手法"]},
    {"unit": "第四单元", "lesson_no": "17", "title": "散文二篇（永久的生命 / 我为什么而活着）", "author": "严文井、罗素", "category": "哲理散文", "keywords": ["永久的生命", "严文井", "生命的奇迹", "我为什么而活着", "罗素", "爱情", "知识", "人类苦难", "同情心"]},
    {"unit": "第四单元", "lesson_no": "18", "title": "昆明的雨", "author": "汪曾祺", "category": "散文", "keywords": ["汪曾祺", "昆明的雨", "菌子", "牛肝菌", "青头菌", "鸡枞", "杨梅", "仙人掌", "缅桂花", "慢生活", "人间草木"]},
    {"unit": "第四单元", "lesson_no": "导读", "title": "名著导读：《红岩》", "author": "罗广斌、杨益言", "category": "名著导读", "keywords": ["红岩", "罗广斌", "杨益言", "江姐", "江竹筠", "许云峰", "小萝卜头", "渣滓洞", "白公馆", "红岩精神"]},
    {"unit": "第五单元", "lesson_no": "19", "title": "中国石拱桥", "author": "茅以昇", "category": "说明文", "keywords": ["茅以昇", "中国石拱桥", "赵州桥", "李春", "卢沟桥", "形式优美", "结构坚固", "历史悠久", "说明顺序", "说明方法"]},
    {"unit": "第五单元", "lesson_no": "20", "title": "苏州园林", "author": "叶圣陶", "category": "说明文", "keywords": ["叶圣陶", "苏州园林", "图画美", "亭台轩榭", "假山池沼", "花草树木", "近景远景", "移步换景", "说明文"]},
    {"unit": "第五单元", "lesson_no": "21", "title": "人民英雄永垂不朽——瞻仰首都人民英雄纪念碑", "author": "周定舫", "category": "说明文", "keywords": ["人民英雄纪念碑", "周定舫", "天安门广场", "碑身", "浮雕", "虎门销烟", "金田起义", "武昌起义", "五四运动", "渡江战役", "空间顺序"]},
    {"unit": "第五单元", "lesson_no": "22", "title": "梦回繁华", "author": "毛宁", "category": "说明文", "keywords": ["梦回繁华", "毛宁", "清明上河图", "张择端", "北宋", "东京汴梁", "汴河", "虹桥", "市井风貌", "工笔风俗画"]},
    {"unit": "第六单元", "lesson_no": "23", "title": "《孟子》三章", "author": "孟子", "category": "文言文", "keywords": ["孟子", "得道多助，失道寡助", "天时不如地利", "地利不如人和", "富贵不能淫", "贫贱不能移", "威武不能屈", "大丈夫", "生于忧患，死于安乐", "舜发于畎亩之中", "天将降大任于是人也", "苦其心志", "劳其筋骨", "行拂乱其所为"]},
    {"unit": "第六单元", "lesson_no": "24", "title": "愚公移山", "author": "《列子》", "category": "文言文/神话寓言", "keywords": ["列子", "愚公移山", "太行", "王屋", "愚公", "智叟", "子子孙孙无穷匮也", "山不加增", "操蛇之神", "夸娥氏二子", "坚持不懈"]},
    {"unit": "第六单元", "lesson_no": "25", "title": "周亚夫军细柳", "author": "司马迁", "category": "文言文", "keywords": ["司马迁", "史记", "周亚夫", "汉文帝", "细柳营", "军中闻将军令", "不闻天子之诏", "真将军", "严谨治军", "忠于职守"]},
    {"unit": "第六单元", "lesson_no": "26", "title": "诗词五首", "author": "陶渊明、杜甫、李贺、杜牧、李清照", "category": "古诗词", "keywords": ["饮酒", "陶渊明", "结庐在人境", "采菊东篱下", "悠然见南山", "春望", "杜甫", "国破山河在", "城春草木深", "感时花溅泪", "恨别鸟惊心", "烽火连三月", "家书抵万金", "雁门太守行", "李贺", "黑云压城城欲摧", "甲光向日金鳞开", "报君黄金台上意", "提携玉龙为君死", "赤壁", "杜牧", "东风不与周郎便", "铜雀春深锁二乔", "渔家傲", "李清照", "天接云涛连晓雾", "九万里风鹏正举"]},
    {"unit": "第六单元", "lesson_no": "古诗", "title": "课外古诗词诵读（上册第二辑）", "author": "晏殊、欧阳修、朱敦儒、李清照", "category": "古诗词诵读", "keywords": ["浣溪沙", "晏殊", "一曲新词酒一杯", "无可奈何花落去", "似曾相识燕归来", "采桑子", "欧阳修", "轻舟短棹西湖好", "相见欢", "朱敦儒", "金陵城上西楼", "如梦令", "李清照", "常记溪亭日暮", "沉醉不知归路", "争渡，争渡，惊起一滩鸥鹭"]}
]

CURRICULUM_V2 = [
    {"unit": "第一单元", "lesson_no": "01", "title": "社戏", "author": "鲁迅", "category": "短篇小说", "keywords": ["鲁迅", "社戏", "平桥村", "双喜", "阿发", "六一公公", "罗汉豆", "月下归航", "戏台", "童年回忆"]},
    {"unit": "第一单元", "lesson_no": "02", "title": "回延安", "author": "贺敬之", "category": "抒情诗", "keywords": ["贺敬之", "回延安", "陕北民歌", "信天游", "延安", "宝塔山", "延河", "革命圣地", "几回回梦里回延安"]},
    {"unit": "第一单元", "lesson_no": "03", "title": "安塞腰鼓", "author": "刘成章", "category": "散文", "keywords": ["刘成章", "安塞腰鼓", "黄土高原", "狂舞", "火烈", "磅礴", "豪迈", "生命力", "后生", "排比句式"]},
    {"unit": "第一单元", "lesson_no": "04", "title": "灯笼", "author": "吴伯箫", "category": "抒情散文", "keywords": ["吴伯箫", "灯笼", "故乡", "童年", "挑灯迎归", "马前卒", "纱灯", "汉献帝", "家国情怀"]},
    {"unit": "第二单元", "lesson_no": "05", "title": "大自然的语言", "author": "竺可桢", "category": "事理说明文", "keywords": ["竺可桢", "大自然的语言", "物候学", "物候现象", "草木萌发", "燕子翩然归来", "纬度差异", "经度差异", "高下差异", "古今差异"]},
    {"unit": "第二单元", "lesson_no": "06", "title": "阿西莫夫短文两篇（恐龙无处不有 / 被压扁的沙子）", "author": "阿西莫夫", "category": "科普说明文", "keywords": ["阿西莫夫", "恐龙无处不有", "大陆漂移", "板块构造", "泛大陆", "被压扁的沙子", "斯石英", "恐龙灭绝", "撞击说", "火山说"]},
    {"unit": "第二单元", "lesson_no": "07", "title": "大雁归来", "author": "利奥波德", "category": "生态散文", "keywords": ["利奥波德", "沙乡年鉴", "大雁归来", "三月大雁", "候鸟", "生态伦理", "联合观念", "爱护动物", "人与自然"]},
    {"unit": "第二单元", "lesson_no": "08", "title": "时间的脚印", "author": "陶世龙", "category": "科普说明文", "keywords": ["陶世龙", "时间的脚印", "岩石", "地质年代", "岩石记录时间", "风化", "沉积", "化石", "沧海桑田"]},
    {"unit": "第二单元", "lesson_no": "导读", "title": "名著导读：《经典常谈》", "author": "朱自清", "category": "名著导读", "keywords": ["经典常谈", "朱自清", "说文解字", "周易", "尚书", "诗经", "三礼", "春秋三传", "四书", "战国策", "史记", "汉书", "国学经典"]},
    {"unit": "第三单元", "lesson_no": "09", "title": "桃花源记", "author": "陶渊明", "category": "古代散文/名篇", "keywords": ["陶渊明", "桃花源记", "武陵人", "晋太元中", "缘溪行", "落英缤纷", "土地平旷", "屋舍俨然", "有良田美池桑竹之属", "黄发垂髫", "怡然自乐", "世外桃源"]},
    {"unit": "第三单元", "lesson_no": "10", "title": "小石潭记", "author": "柳宗元", "category": "山水游记", "keywords": ["柳宗元", "小石潭记", "永州八记", "全石以为底", "潭中鱼可百许头", "皆若空游无所依", "日光下澈", "影布石上", "俶尔远逝", "凄神寒骨", "悄怆幽邃"]},
    {"unit": "第三单元", "lesson_no": "11", "title": "核舟记", "author": "魏学洢", "category": "古代说明文", "keywords": ["魏学洢", "核舟记", "王叔远", "微雕", "大苏泛赤壁", "苏轼", "黄庭坚", "佛印", "箬篷", "楫左右各四容", "神态各异", "技亦灵怪矣哉"]},
    {"unit": "第三单元", "lesson_no": "12", "title": "《诗经》二首（关雎 / 蒹葭）", "author": "《诗经》", "category": "先秦诗歌", "keywords": ["诗经", "关雎", "关关雎鸠", "在河之洲", "窈窕淑女", "君子好逑", "参差荇菜", "蒹葭", "蒹葭苍苍", "白露为霜", "所谓伊人", "在水一方", "重章叠句", "赋比兴"]},
    {"unit": "第三单元", "lesson_no": "古诗", "title": "课外古诗词诵读（下册第一辑）", "author": "王勃、孟浩然等", "category": "古诗词诵读", "keywords": ["式微", "诗经", "式微式微，胡不归", "子衿", "青青子衿，悠悠我心", "送杜少府之任蜀州", "王勃", "城阙辅三秦", "风烟望五津", "海内存知己", "天涯若比邻", "望洞庭湖赠张丞相", "孟浩然", "气蒸云梦泽", "波撼岳阳城", "坐观垂钓者", "徒有羡鱼情"]},
    {"unit": "第四单元活动·探究", "lesson_no": "13", "title": "最后一次讲演", "author": "闻一多", "category": "演讲词", "keywords": ["闻一多", "最后一次讲演", "李公朴", "反动派", "昆明", "正义是杀不完的", "光明就在眼前", "大无畏精神"]},
    {"unit": "第四单元活动·探究", "lesson_no": "14", "title": "应有格物致知精神", "author": "丁肇中", "category": "演讲词/议论文", "keywords": ["丁肇中", "格物致知", "实验精神", "大学", "探索真理", "自然科学", "科学实验", "动手实践"]},
    {"unit": "第四单元活动·探究", "lesson_no": "15", "title": "我一生中的重要抉择", "author": "王选", "category": "演讲词", "keywords": ["王选", "汉字激光照排系统", "重要抉择", "科学研究", "跨越发展", "献身科学", "扶持青年"]},
    {"unit": "第四单元活动·探究", "lesson_no": "16", "title": "庆祝奥林匹克运动复兴25周年", "author": "顾拜旦", "category": "演讲词", "keywords": ["顾拜旦", "奥林匹克", "现代奥运会", "奥林匹克精神", "体育教育", "和平友谊", "青年"]},
    {"unit": "第五单元", "lesson_no": "17", "title": "壶口瀑布", "author": "梁衡", "category": "游记散文", "keywords": ["梁衡", "壶口瀑布", "黄河", "雨季壶口", "枯水季壶口", "排山倒海", "如雷贯耳", "民族精神", "勇往直前"]},
    {"unit": "第五单元", "lesson_no": "18", "title": "在长江源头各拉丹冬", "author": "马丽华", "category": "游记散文", "keywords": ["马丽华", "各拉丹冬", "长江源头", "冰塔林", "冰川", "青藏高原", "高原反应", "大自然奇观"]},
    {"unit": "第五单元", "lesson_no": "19", "title": "登勃朗峰", "author": "马克·吐温", "category": "游记散文", "keywords": ["马克·吐温", "勃朗峰", "阿尔卑斯山", "登山", "车夫之王", "幽默风趣", "雪山风光"]},
    {"unit": "第五单元", "lesson_no": "20", "title": "一滴水经过丽江", "author": "阿来", "category": "游记散文", "keywords": ["阿来", "一滴水经过丽江", "丽江古城", "玉龙雪山", "四方街", "东巴文", "纳西族", "水车", "第一人称视角"]},
    {"unit": "第六单元", "lesson_no": "21", "title": "《庄子》二则（北冥有鱼 / 庄子与惠子游于濠梁之上）", "author": "庄子", "category": "文言文/哲学散文", "keywords": ["庄子", "北冥有鱼", "其名为鲲", "化而为鸟，其名为鹏", "抟扶摇而上者九万里", "野马也，尘埃也", "濠梁之辩", "庄子与惠子", "子非鱼，安知鱼之乐", "子非我，安知我不知鱼之乐"]},
    {"unit": "第六单元", "lesson_no": "22", "title": "《礼记》二则（虽有嘉肴 / 大道之行也）", "author": "《礼记》", "category": "古代典籍", "keywords": ["礼记", "虽有嘉肴", "弗食，不知其旨也", "虽有至道，弗学，不知其善也", "教学相长", "大道之行也", "天下为公", "选贤与能", "讲信修睦", "大同社会"]},
    {"unit": "第六单元", "lesson_no": "23", "title": "马说", "author": "韩愈", "category": "古代杂文/议论文", "keywords": ["韩愈", "马说", "世有伯乐，然后有千里马", "千里马常有，而伯乐不常有", "骈死于槽枥之间", "食不饱，力不足，才美不外见", "策之不以其道", "食之不能尽其材", "鸣之而不能通其意", "执策而临之，曰：“天下无马！”", "呜呼！其真无马邪？其真不知马也！", "托物寓意", "怀才不遇"]},
    {"unit": "第六单元", "lesson_no": "24", "title": "唐诗三首", "author": "杜甫、白居易", "category": "古诗词", "keywords": ["石壕吏", "杜甫", "暮投石壕村，有吏夜捉人", "老翁逾墙走，老妇出门看", "听妇前致词：三男邺城戍", "茅屋为秋风所破歌", "八月秋高风怒号，卷我屋上三重茅", "安得广厦千万间，大庇天下寒士俱欢颜！风雨不动安如山", "呜呼！何时眼前突兀见此屋，吾庐独破受冻死亦足！", "卖炭翁", "白居易", "卖炭翁，伐薪烧炭南山中", "满面尘灰烟火色，两鬓苍苍十指黑", "可怜身上衣正单，心忧炭贱愿天寒", "一车炭，千余斤，宫使驱将惜不得"]},
    {"unit": "第六单元", "lesson_no": "古诗", "title": "课外古诗词诵读（下册第二辑）", "author": "常建、李白、苏轼、陆游", "category": "古诗词诵读", "keywords": ["题破山寺后禅院", "常建", "清晨入古寺，初日照高林", "曲径通幽处，禅房花木深", "山光悦鸟性，潭影空人心", "送友人", "李白", "青山横北郭，白水绕东城", "此地一为别，孤蓬万里征", "浮云游子意，落日故人情", "挥手自兹去，萧萧班马鸣", "卜算子·黄州定慧院寓居作", "苏轼", "缺月挂疏桐，漏断人初静", "谁见幽人独往来，缥缈孤鸿影", "惊起却回头，有恨无人省", "拣尽寒枝不肯栖，寂寞沙洲冷", "卜算子·咏梅", "陆游", "驿外断桥边，寂寞开无主", "已是黄昏独自愁，更著风和雨", "无意苦争春，一任群芳妒", "零落成泥碾作尘，只有香如故"]}
]

def clean_lesson_content(raw_text):
    # 替换图片相对路径为上层目录
    res = raw_text.replace('src="imgs/', 'src="../imgs/')
    # 去除多余的连续空白行
    res = re.sub(r'\n{3,}', '\n\n', res)
    return res.strip()

def build_lessons_from_curriculum(volume_dir, volume_name, book_md_filename, curriculum):
    lessons_dir = os.path.join(volume_dir, "lessons")
    catalog_path = os.path.join(volume_dir, "catalog.json")
    os.makedirs(lessons_dir, exist_ok=True)

    with open(os.path.join(volume_dir, book_md_filename), "r", encoding="utf-8") as f:
        book_content = f.read()

    pages = book_content.split("\n\n---\n\n")

    catalog_items = []
    print(f"\n==========================================")
    print(f"正在精细化生成 {volume_name}（共 {len(curriculum)} 篇核心课文与诗歌专题）...")
    print(f"==========================================")

    # 对每篇课文在全书内容中搜索最佳匹配页面范围
    for idx, item in enumerate(curriculum):
        title = item["title"]
        author = item["author"]
        unit = item["unit"]
        category = item["category"]
        keywords = item["keywords"]

        # 核心搜索词
        search_terms = [title.split("（")[0].replace("《", "").replace("》", "")] + keywords[:4]

        # 评分找出最匹配的连续页面
        page_scores = []
        for p_idx, p in enumerate(pages):
            score = 0
            for term in search_terms:
                if term in p:
                    score += p.count(term) * (10 if term == search_terms[0] else 2)
            page_scores.append((p_idx, score))

        # 找到最高得分页面作为中心
        best_page_idx = max(range(len(page_scores)), key=lambda i: page_scores[i][1])
        
        # 选取最佳页面及其后 1~3 页（直到下一篇或无内容）
        start_p = best_page_idx
        end_p = min(start_p + 3, len(pages))
        
        matched_content = "\n\n---\n\n".join(pages[start_p:end_p])
        cleaned_content = clean_lesson_content(matched_content)

        safe_title = re.sub(r'[\\/:*?"<>|\s（）《》]', '_', title)[:18].strip('_')
        safe_unit = re.sub(r'[\\/:*?"<>|\s]', '_', unit)[:10].strip('_')
        file_name = f"{safe_unit}_{idx+1:02d}_{safe_title}.md"
        lesson_file_path = os.path.join(lessons_dir, file_name)

        # 构建规范 YAML Frontmatter
        frontmatter = f"""---
id: "{volume_name}_{idx+1:02d}"
title: "{title}"
author: "{author}"
unit: "{unit}"
lesson_no: "{item['lesson_no']}"
category: "{category}"
volume: "{volume_name}"
start_page: {start_p + 1}
keywords: {json.dumps(keywords, ensure_ascii=False)}
---

# {title}

**【学科】** 语文 | **【学段/年级】** 初中八年级 | **【册次】** {volume_name} | **【单元】** {unit}  
**【作者/出处】** {author} | **【体裁类别】** {category}

---

## 课文正文与教学内容

{cleaned_content}
"""
        with open(lesson_file_path, "w", encoding="utf-8") as lf:
            lf.write(frontmatter)

        catalog_entry = {
            "id": f"{volume_name}_{idx+1:02d}",
            "title": title,
            "unit": unit,
            "author": author,
            "category": category,
            "lessonNo": item["lesson_no"],
            "fileName": file_name,
            "relPath": f"lessons/{file_name}",
            "startPage": start_p + 1,
            "keywords": keywords
        }
        catalog_items.append(catalog_entry)
        print(f"  [{idx+1:02d}/{len(curriculum)}] 已生成: {file_name} (起始页: P{start_p + 1}, 作者: {author})")

    catalog_data = {
        "volume": volume_name,
        "totalLessons": len(catalog_items),
        "items": catalog_items
    }
    with open(catalog_path, "w", encoding="utf-8") as cf:
        json.dump(catalog_data, cf, ensure_ascii=False, indent=2)

    print(f"\n[√] {volume_name} 全部完成！已生成索引清单: {catalog_path}")

def main():
    base_dir = r"knowledge-base\chinese\grade8"
    build_lessons_from_curriculum(os.path.join(base_dir, "volume_1"), "volume_1", "Book 1.md", CURRICULUM_V1)
    build_lessons_from_curriculum(os.path.join(base_dir, "volume_2"), "volume_2", "Book 2.md", CURRICULUM_V2)
    print("\n==========================================")
    print("八年级上、下册全部结构化课程 Markdown 与索引生成完毕！")
    print("==========================================")

if __name__ == "__main__":
    main()
