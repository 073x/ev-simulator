// Partial Copyright Jerome Benoit. 2021. All Rights Reserved.

import { CircularArray, DEFAULT_CIRCULAR_ARRAY_SIZE } from './CircularArray';
import { IncomingRequestCommand, RequestCommand } from '../types/ocpp/Requests';
import { PerformanceEntry, PerformanceObserver, performance } from 'perf_hooks';
import Statistics, { StatisticsData } from '../types/Statistics';

import Configuration from './Configuration';
import { MessageType } from '../types/ocpp/MessageType';
import Utils from './Utils';
import logger from './Logger';

export default class PerformanceStatistics {
  private objId: string;
  private performanceObserver: PerformanceObserver;
  private statistics: Statistics;
  private displayInterval: NodeJS.Timeout;

  public constructor(objId: string) {
    this.objId = objId;
    this.initializePerformanceObserver();
    this.statistics = { id: this.objId ?? 'Object id not specified', statisticsData: {} };
  }

  public static beginMeasure(id: string): string {
    const beginId = 'begin' + id.charAt(0).toUpperCase() + id.slice(1);
    performance.mark(beginId);
    return beginId;
  }

  public static endMeasure(name: string, beginId: string): void {
    performance.measure(name, beginId);
    performance.clearMarks(beginId);
  }

  public addRequestStatistic(command: RequestCommand | IncomingRequestCommand, messageType: MessageType): void {
    switch (messageType) {
      case MessageType.CALL_MESSAGE:
        if (this.statistics.statisticsData[command] && this.statistics.statisticsData[command].countRequest) {
          this.statistics.statisticsData[command].countRequest++;
        } else {
          this.statistics.statisticsData[command] = {} as StatisticsData;
          this.statistics.statisticsData[command].countRequest = 1;
        }
        break;
      case MessageType.CALL_RESULT_MESSAGE:
        if (this.statistics.statisticsData[command]) {
          if (this.statistics.statisticsData[command].countResponse) {
            this.statistics.statisticsData[command].countResponse++;
          } else {
            this.statistics.statisticsData[command].countResponse = 1;
          }
        } else {
          this.statistics.statisticsData[command] = {} as StatisticsData;
          this.statistics.statisticsData[command].countResponse = 1;
        }
        break;
      case MessageType.CALL_ERROR_MESSAGE:
        if (this.statistics.statisticsData[command]) {
          if (this.statistics.statisticsData[command].countError) {
            this.statistics.statisticsData[command].countError++;
          } else {
            this.statistics.statisticsData[command].countError = 1;
          }
        } else {
          this.statistics.statisticsData[command] = {} as StatisticsData;
          this.statistics.statisticsData[command].countError = 1;
        }
        break;
      default:
        logger.error(`${this.logPrefix()} wrong message type ${messageType}`);
        break;
    }
  }

  public start(): void {
    this.startDisplayInterval();
  }

  public stop(): void {
    if (this.displayInterval) {
      clearInterval(this.displayInterval);
    }
    performance.clearMarks();
    this.performanceObserver?.disconnect();
  }

  public restart(): void {
    this.stop();
    this.start();
  }

  private initializePerformanceObserver(): void {
    this.performanceObserver = new PerformanceObserver((list) => {
      this.addPerformanceEntryToStatistics(list.getEntries()[0]);
      logger.debug(`${this.logPrefix()} '${list.getEntries()[0].name}' performance entry: %j`, list.getEntries()[0]);
    });
    this.performanceObserver.observe({ entryTypes: ['measure'] });
  }

  private logStatistics(): void {
    logger.info(this.logPrefix() + ' %j', this.statistics);
  }

  private startDisplayInterval(): void {
    if (Configuration.getStatisticsDisplayInterval() > 0) {
      this.displayInterval = setInterval(() => {
        this.logStatistics();
      }, Configuration.getStatisticsDisplayInterval() * 1000);
      logger.info(this.logPrefix() + ' displayed every ' + Utils.secondsToHHMMSS(Configuration.getStatisticsDisplayInterval()));
    } else {
      logger.info(this.logPrefix() + ' display interval is set to ' + Configuration.getStatisticsDisplayInterval().toString() + '. Not displaying statistics');
    }
  }

  private median(dataSet: number[]): number {
    if (Array.isArray(dataSet) && dataSet.length === 1) {
      return dataSet[0];
    }
    const sortedDataSet = dataSet.slice().sort((a, b) => (a - b));
    const middleIndex = Math.floor(sortedDataSet.length / 2);
    if (sortedDataSet.length % 2) {
      return sortedDataSet[middleIndex / 2];
    }
    return (sortedDataSet[(middleIndex - 1)] + sortedDataSet[middleIndex]) / 2;
  }

  // TODO: use order statistics tree https://en.wikipedia.org/wiki/Order_statistic_tree
  private percentile(dataSet: number[], percentile: number): number {
    if (percentile < 0 && percentile > 100) {
      throw new RangeError('Percentile is not between 0 and 100');
    }
    if (Utils.isEmptyArray(dataSet)) {
      return 0;
    }
    const sortedDataSet = dataSet.slice().sort((a, b) => (a - b));
    if (percentile === 0) {
      return sortedDataSet[0];
    }
    if (percentile === 100) {
      return sortedDataSet[sortedDataSet.length - 1];
    }
    const percentileIndex = ((percentile / 100) * sortedDataSet.length) - 1;
    if (Number.isInteger(percentileIndex)) {
      return (sortedDataSet[percentileIndex] + sortedDataSet[percentileIndex + 1]) / 2;
    }
    return sortedDataSet[Math.round(percentileIndex)];
  }

  private stdDeviation(dataSet: number[]): number {
    let totalDataSet = 0;
    for (const data of dataSet) {
      totalDataSet += data;
    }
    const dataSetMean = totalDataSet / dataSet.length;
    let totalGeometricDeviation = 0;
    for (const data of dataSet) {
      const deviation = data - dataSetMean;
      totalGeometricDeviation += deviation * deviation;
    }
    return Math.sqrt(totalGeometricDeviation / dataSet.length);
  }

  private addPerformanceEntryToStatistics(entry: PerformanceEntry): void {
    let entryName = entry.name;
    // Rename entry name
    const MAP_NAME: Record<string, string> = {};
    if (MAP_NAME[entryName]) {
      entryName = MAP_NAME[entryName];
    }
    // Initialize command statistics
    if (!this.statistics.statisticsData[entryName]) {
      this.statistics.statisticsData[entryName] = {} as StatisticsData;
    }
    // Update current statistics
    this.statistics.statisticsData[entryName].countTimeMeasurement = this.statistics.statisticsData[entryName].countTimeMeasurement ? this.statistics.statisticsData[entryName].countTimeMeasurement + 1 : 1;
    this.statistics.statisticsData[entryName].currentTimeMeasurement = entry.duration;
    this.statistics.statisticsData[entryName].minTimeMeasurement = this.statistics.statisticsData[entryName].minTimeMeasurement ? (this.statistics.statisticsData[entryName].minTimeMeasurement > entry.duration ? entry.duration : this.statistics.statisticsData[entryName].minTimeMeasurement) : entry.duration;
    this.statistics.statisticsData[entryName].maxTimeMeasurement = this.statistics.statisticsData[entryName].maxTimeMeasurement ? (this.statistics.statisticsData[entryName].maxTimeMeasurement < entry.duration ? entry.duration : this.statistics.statisticsData[entryName].maxTimeMeasurement) : entry.duration;
    this.statistics.statisticsData[entryName].totalTimeMeasurement = this.statistics.statisticsData[entryName].totalTimeMeasurement ? this.statistics.statisticsData[entryName].totalTimeMeasurement + entry.duration : entry.duration;
    this.statistics.statisticsData[entryName].avgTimeMeasurement = this.statistics.statisticsData[entryName].totalTimeMeasurement / this.statistics.statisticsData[entryName].countTimeMeasurement;
    Array.isArray(this.statistics.statisticsData[entryName].timeMeasurementSeries) ? this.statistics.statisticsData[entryName].timeMeasurementSeries.push(entry.duration) : this.statistics.statisticsData[entryName].timeMeasurementSeries = new CircularArray<number>(DEFAULT_CIRCULAR_ARRAY_SIZE, entry.duration);
    this.statistics.statisticsData[entryName].medTimeMeasurement = this.median(this.statistics.statisticsData[entryName].timeMeasurementSeries);
    this.statistics.statisticsData[entryName].ninetyFiveThPercentileTimeMeasurement = this.percentile(this.statistics.statisticsData[entryName].timeMeasurementSeries, 95);
    this.statistics.statisticsData[entryName].stdDevTimeMeasurement = this.stdDeviation(this.statistics.statisticsData[entryName].timeMeasurementSeries);
  }

  private logPrefix(): string {
    return Utils.logPrefix(` ${this.objId} | Performance statistics`);
  }
}
