/**
 * 文档解析器统一接口
 */
export interface IDocumentParser {
  /**
   * 解析指定物理文件路径的文档，提取纯文本内容
   * @param filePath 物理文件绝对路径或可访问的相对路径
   * @returns 提取出的纯文本内容
   */
  parse(filePath: string): Promise<string>;
}
