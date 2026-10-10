namespace Acme.Core
{
    public readonly record struct Reading(double Value);

    internal enum Unit
    {
        Celsius,
        Kelvin,
    }

    public interface IMetricSource
    {
        Reading Read();
    }

    public class Cache<T>
    {
        public T Value { get; set; }
    }
}
