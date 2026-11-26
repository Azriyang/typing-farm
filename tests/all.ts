/**
 * 测试入口：按顺序加载各测试文件，最后汇总。
 * 新增测试文件时在这里加一行 import。
 */
import './core.test';
import { report } from './harness';

report();
